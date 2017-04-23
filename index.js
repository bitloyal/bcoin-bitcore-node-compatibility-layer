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
      .map((name) => this[name] = this[name].bind(this))
  }

  open () {
    this.rpc.add('getaddresstxids', this._getAddressTxIds)
    this.rpc.add('getaddressdeltas', this._getAddressDeltas)
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

  async getAddressTxs (addresses, start, end) {
    if (this.chain.options.spv) {
      throw new RPCError('Cannot get TX in SPV mode.')
    }

    return Promise.all(addresses.map(async (address) => {
      const result = []

      const metas = await this.node.getMetaByAddress(address)
      const rangedMetas = metas.filter((meta) => (
        meta.height >= start && meta.height <= end
      ))

      for (let meta, view, i = 0; i < rangedMetas.length; i++) {
        meta = rangedMetas[i]
        view = await this.node.getMetaView(meta)

        result.push({
          tx: meta.getJSON(this.network, view),
          address
        })
      }

      return result
    }))
  }

  getTxDeltas (tx, address) {
    const txid = tx.hash
    const blockIndex = tx.index
    const height = tx.height

    const base = {
      txid,
      blockIndex,
      height,
      address
    }

    return tx.inputs.map((input, index) => {
      if (input.coin && input.coin.address &&
        input.coin.address === address) {
        return Object.assign({}, base, {
          index,
          satoshis: parseFloat(input.coin.value) * -1e8
        })
      }
      return null
    }).filter((notNull) => notNull)
    .concat(tx.outputs.map((output, index) => {
      if (output.address && output.address === address) {
        return Object.assign({}, base, {
          index,
          satoshis: parseFloat(output.value) * 1e8
        })
      }
      return null
    }).filter((notNull) => notNull))
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

    return txs
      .reduce((res, cur) => res.concat(cur), [])
      .map(({ tx }) => tx.hash)
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
      await this.getAddressTxs(addresses, start, end)

    return txs
      .reduce((res, cur) => res.concat(cur), [])
      .map(({ tx, address }) => (
        this.getTxDeltas(tx, address.toString())
      ))
      .reduce((res, cur) => res.concat(cur), [])
      .sort((a, b) => a.height > b.height ? 1 : -1 )
  }
}

module.exports = BitcoreNodeCompatibilityLayer
