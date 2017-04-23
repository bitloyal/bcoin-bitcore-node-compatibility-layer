const assert = require('assert')

const consensus = require('bcoin/lib/protocol/consensus')
const FullNode = require('bcoin/lib/node/fullnode')
const WalletDB = require('bcoin/lib/wallet/plugin')
const RPCClient = require('bcoin/lib/http/rpcclient')
const CoinView = require('bcoin/lib/coins/coinview')

const BitcoreNodeCompatibilityLayer = require('.')

describe('BitcoreNodeCompatibilityLayer', function () {
  const node = new FullNode({
    db: 'memory',
    network: 'regtest',
    indexTX: true,
    indexAddress: true
  })

  node.on('error', () => {})

  const chain = node.chain
  const walletdb = node.use(WalletDB)
  const bncl = node.use(BitcoreNodeCompatibilityLayer)
  const miner = node.miner
  const client = new RPCClient({ network: 'regtest' })

  const blocks = []
  const receives = []
  const changes = []
  const unconfirmed = []
  const confirmed = []

  let wallet

  const mineBlock = async () => {
    miner.addresses.length = 0
    changes.push(wallet.getChange())
    miner.addAddress(changes[changes.length-1])
    const job = await miner.createJob()
    let tx
    while (tx = unconfirmed.pop()) {
      job.addTX(tx, new CoinView())
      confirmed.push(tx)
    }
    job.refresh()
    blocks.push(await job.mineAsync())
    await chain.add(blocks[blocks.length-1])
    await walletdb.rescan()
  }

  const sendTransactions = async (n) => {
    receives.push(wallet.getReceive())
    while (n--) {
      unconfirmed.push(await wallet.send({
        outputs: [{
          address: receives[receives.length-1],
          value: 25*1e8
        }]
      }))
    }
    await walletdb.rescan()
  }

  it('should open chain and miner', async () => {
    miner.mempool = null
    consensus.COINBASE_MATURITY = 0
    await node.open()
  })

  it('should open walletdb', async () => {
    wallet = await walletdb.create()
  })

  it('should mine an empty block', async () => {
    blocks.push(await mineBlock())
  })

  it('should fail to receive tx ids by address', async () => {
    await sendTransactions(1)
    try {
      await client.execute('getaddresstxids', [{}])
    } catch (err) {
      assert(err.message === 'Missing addresses parameter.')
    }
  })

  it('should receive tx ids in mempool by address', async () => {
    const res = await client.execute('getaddresstxids', [{
      addresses: [receives[0].toString()]
    }])
    assert(res[0] === unconfirmed[0].rhash().toString('hex'))
  })

  it('should receive tx ids in db by address', async () => {
    await mineBlock()
    const res = await client.execute('getaddresstxids', [{
      addresses: [receives[0].toString()],
      start: 0,
      end: 2
    }])
    assert(res[0] === confirmed[0].rhash().toString('hex'))
  })

  it('should receive no tx ids in db by address (bad range)', async () => {
    const res = await client.execute('getaddresstxids', [{
      addresses: [receives[0].toString()],
      start: 3
    }])
    assert(!res.length)
  })

  it('should receive many tx ids for many addresses', async () => {
    await sendTransactions(1)
    await mineBlock()
    const res = await client.execute('getaddresstxids', [{
      addresses: [
        receives[0].toString(),
        receives[1].toString()
      ],
      start: 0
    }])
    assert(res[0] === confirmed[0].rhash().toString('hex'))
    assert(res[1] === confirmed[1].rhash().toString('hex'))
  })

  it('should receive many deltas for many addresses', async () => {
    await sendTransactions(1)
    await mineBlock()
    const addresses = [
      changes[0].toString(),
      receives[0].toString()
    ]
    const res = await client.execute('getaddressdeltas', [{
      addresses,
      start: 0
    }])

    const assertDelta =
      async (delta, address, index, satoshis) => {
        const hash = await chain.db.getHash(delta.height)
        const block = await node.getBlock(hash)
        const tx = block.txs[delta.blockIndex]
        const meta = await node.getMeta(tx.hash().toString('hex'))
        assert(JSON.stringify(delta) === JSON.stringify({
          txid: tx.rhash().toString('hex'),
          blockIndex: meta.index,
          height: meta.height,
          address,
          index,
          satoshis
        }))
      }

    await assertDelta(res[0], addresses[0], 0, 50 * 1e8)
    await assertDelta(res[1], addresses[0], 0, 50 * -1e8)
    await assertDelta(res[2], addresses[1], 1, 25 * 1e8)
  })

  it('should cleanup', async () => {
    consensus.COINBASE_MATURITY = 100
    await node.close()
  })
})
