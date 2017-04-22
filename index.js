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
  }

  close () {
  }

  async _getAddressTxIds (args, help) {
    if (help) {
      throw new RPCError(
        errors.MISC,
        'getaddresstxids ' +
        '\'{"addresses": [<address>,...], ' +
        '"start": <height>, "end": <height>}\'}')
    }

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
    
    const txs = await Promise.all(addresses.map(async (address) => {
      const result = []

      if (this.chain.options.spv) {
        throw new RPCError('Cannot get TX in SPV mode.')
      }

      const metas = await this.node.getMetaByAddress(address)
      const rangedMetas = metas.filter((meta) => (
        meta.height >= start && meta.height <= end 
      ))

      for (let meta, view, i = 0; i < rangedMetas.length; i++) {
        meta = rangedMetas[i]
        view = await this.node.getMetaView(meta)
        result.push(meta.getJSON(this.network, view))
      }

      return result
    }))

    return txs.reduce((res, cur) => res.concat(cur))
      .map((tx) => tx.hash)
  }
}

module.exports = BitcoreNodeCompatibilityLayer
