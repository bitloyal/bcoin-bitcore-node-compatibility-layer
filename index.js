const Validator = require('bcoin/lib/utils/validator')
const { errors, RPCError } = require('bcoin/lib/http/rpcbase')

class BitcoreNodeCompatibilityLayer {
  static get id () {
    return 'bitcore-node-compatibility-layer'
  }

  static init (node) {
    const { network, mempool, chain, rpc } = node
    return new BitcoreNodeCompatibilityLayer({
      node, network, mempool, chain, rpc
    })
  }

  constructor ({ node, network, mempool, chain, rpc }) {
    Object.assign(this, {
      node, network, mempool, chain, rpc
    })
    Object.getOwnPropertyNames(Object.getPrototypeOf(this))
      .filter((name) => name[0] === '_')
      .map((name) => { this[name] = this[name].bind(this) })
  }

  open () {
    this.rpc.add('getaddresstxids', this._getAddressTxIds)
    this.rpc.add('getaddressdeltas', this._getAddressDeltas)
    this.rpc.add('getaddressbalance', this._getAddressBalance)
    this.rpc.add('getaddressutxos', this._getAddressUtxos)
    this.rpc.add('getaddressmempool', this._getAddressMempool)
  }

  close () {
  }

  validateArgs (args) {
    let valid = new Validator([new Validator([args]).obj(0)])
    const addresses = valid.array('addresses')

    if (!addresses) {
      throw new RPCError(
        errors.TYPE_ERROR, 'Missing addresses parameter.')
    }

    let start = valid.num('start')
    let end = valid.num('end')

    if (!start) {
      start = -1
    }

    if (!end) {
      end = Infinity
    }

    return { addresses, start, end }
  }

  async getAddressMetas (addresses, start, end) {
    if (this.chain.options.spv) {
      throw new RPCError('Cannot get TX in SPV mode.')
    }

    const metas = await Promise.all(addresses.map(async (address) => {
      const metas =
        await this.node.getMetaByAddress(address)

      return metas
        .filter((meta) => (
          meta.height >= start && meta.height <= end
        ))
        .map((meta) => ({
          meta,
          address
        }))
    }))

    return metas.reduce((res, cur) => res.concat(cur), [])
  }

  async getAddressTxs (addresses, start, end) {
    if (this.chain.options.spv) {
      throw new RPCError('Cannot get TX in SPV mode.')
    }

    const metas =
      await this.getAddressMetas(addresses, start, end)

    const txs = await Promise.all(metas
      .map(async ({ meta, address }) => {
        const view = await this.node.getMetaView(meta)
        const jsonTX = meta.getJSON(this.network, view)
        if (!jsonTX.ts) {
          jsonTX.ts = this.mempool.getEntry(meta.tx.hash('hex')).ts
        }
        return {
          tx: jsonTX,
          address
        }
      }))

    return txs
  }

  getTxDeltas (base, tx, exclude) {
    return tx.inputs.map((input, index) => {
      if (input.coin && input.coin.address &&
        input.coin.address === base.address) {
        return Object.assign({}, base, {
          index,
          satoshis: parseFloat(input.coin.value) * -1e8,
          prevtxid: input.prevout.hash,
          prevout: input.prevout.index
        })
      }
      return null
    }).filter((notNull) => notNull)
      .concat(tx.outputs.map((output, index) => {
        if (output.address && output.address === base.address) {
          return Object.assign({}, base, {
            index,
            satoshis: parseFloat(output.value) * 1e8
          })
        }
        return null
      }).filter((notNull) => notNull))
      .map((delta) => {
        if (exclude) {
          exclude.map((key) => {
            delete delta[key]
          })
        }
        return delta
      })
  }

  async _getAddressTxIds (args, help) {
    if (help) {
      throw new RPCError(
        errors.MISC,
        'getaddresstxids ' +
        '\'{"addresses": [<address>,...], ' +
        '"start": <height>, "end": <height>}\'}')
    }

    const { addresses, start, end } =
      this.validateArgs(args)

    const txs =
      await this.getAddressTxs(addresses, start, end)

    return txs.map(({ tx }) => tx.hash)
  }

  async _getAddressDeltas (args, help) {
    if (help) {
      throw new RPCError(
        errors.MISC,
        'getaddressdeltas ' +
        '\'{"addresses": [<address>,...], ' +
        '"start": <height>, "end": <height>}\'}')
    }

    const { addresses, start, end } =
      this.validateArgs(args)

    const txs =
      await this.getAddressTxs(addresses,
        start === -1 ? 0 : start, end)

    return txs
      .map(({ tx, address }) => (
        this.getTxDeltas({
          txid: tx.hash,
          blockIndex: tx.index,
          height: tx.height,
          address
        }, tx, ['prevtxid', 'prevout'])
      ))
      .reduce((res, cur) => res.concat(cur), [])
      .sort((a, b) => a.height > b.height ? 1 : -1)
  }

  async _getAddressBalance (args, help) {
    if (help) {
      throw new RPCError(
        errors.MISC,
        'getaddressbalance ' +
        '\'{"addresses": [<address>,...]}')
    }

    const { addresses } = this.validateArgs(args)

    const txs =
      await this.getAddressTxs(addresses, 0, Infinity)

    const deltas = txs
      .map(({ tx, address }) => (
        this.getTxDeltas({
          txid: tx.hash,
          blockIndex: tx.index,
          height: tx.height,
          address
        }, tx, ['prevtxid', 'prevout'])
      ))
      .reduce((res, cur) => res.concat(cur), [])
      .sort((a, b) => a.height > b.height ? 1 : -1)

    return {
      balance: deltas.reduce((total, delta) => (
        total + delta.satoshis
      ), 0),
      received: deltas
        .filter((delta) => delta.satoshis > 0)
        .reduce((total, delta) => (
          total + delta.satoshis
        ), 0)
    }
  }

  async _getAddressUtxos (args, help) {
    if (help) {
      throw new RPCError(
        errors.MISC,
        'getaddressutxos ' +
        '\'{"addresses": [<address>,...]}')
    }

    const { addresses } = this.validateArgs(args)

    const txs =
      await this.getAddressTxs(addresses, 0, Infinity)

    return txs.map(({ tx, address }) => (
      tx.outputs
        .map((output, index) => ({ output, index }))
        .filter(({ output }) => output.address === address)
        .map(({ output, index }) => ({
          address,
          txid: tx.hash,
          outputIndex: index,
          script: output.script,
          satoshis: output.value * 1e8,
          height: tx.height
        })
    ))).reduce((res, cur) => res.concat(cur), [])
  }

  async _getAddressMempool (args, help) {
    if (help) {
      throw new RPCError(
        errors.MISC,
        'getaddressmempool ' +
        '\'{"addresses": [<address>,...]}')
    }

    const { addresses } = this.validateArgs(args)

    const txs =
      await this.getAddressTxs(addresses, -1, -1)

    return txs
      .map(({ tx, address }) => (
        this.getTxDeltas({
          txid: tx.hash,
          timestamp: tx.ts,
          address
        }, tx)
      ))
      .reduce((res, cur) => res.concat(cur), [])
      .sort((a, b) => a.height > b.height ? 1 : -1)
  }
}

module.exports = BitcoreNodeCompatibilityLayer
