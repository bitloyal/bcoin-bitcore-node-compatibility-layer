const assert = require('assert')

const consensus = require('bcoin/lib/protocol/consensus')
const FullNode = require('bcoin/lib/node/fullnode')
const WalletDB = require('bcoin/lib/wallet/plugin')
const RPCClient = require('bcoin/lib/http/rpcclient')
const CoinView = require('bcoin/lib/coins/coinview')

const BitcoreNodeCompatibilityLayer = require('.')

describe('BitcoreNodeCompatibilityLayer', () => {
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
  const addresses = []
  const txs = []

  let wallet

  const mineBlock = async () => {
    const job = await miner.createJob()
    job.addTX(txs[txs.length-1], new CoinView())
    job.refresh()
    blocks.push(await job.mineAsync())
    await chain.add(blocks[blocks.length-1])
    await walletdb.rescan()
  }

  const sendTransaction = async () => {
    addresses.push(wallet.getReceive())
    txs.push(await wallet.send({
      outputs: [{
        address: addresses[addresses.length-1],
        value: 12*1e8
      }]
    }))
    await walletdb.rescan()
  }

  it('should open chain and miner', async () => {
    miner.mempool = null
    consensus.COINBASE_MATURITY = 0
    await node.open()
  })

  it('should open walletdb', async () => {
    wallet = await walletdb.create()
    miner.addresses.length = 0
    addresses.push(wallet.getReceive())
    miner.addAddress(addresses[0])
  })

  it('should mine an empty block', async () => {
    blocks.push(await miner.mineBlock())
    await chain.add(blocks[0])
    await walletdb.rescan()
  })

  it('should fail to receive txs by address', async () => {
    await sendTransaction()
    try {
      await client.execute('getaddresstxids', [{}])
    } catch (err) {
      assert(err.message === 'Missing addresses parameter.')
    }
  })

  it('should receive txs in mempool by address', async () => {
    const res = await client.execute('getaddresstxids', [{
      addresses: [addresses[1].toString()]
    }])
    assert(res[0] === txs[0].rhash().toString('hex'))
  })

  it('should receive txs in db by address', async () => {
    await mineBlock() 
    const res = await client.execute('getaddresstxids', [{
      addresses: [addresses[1].toString()],
      start: 0,
      end: 2
    }])
    assert(res[0] === txs[0].rhash().toString('hex'))
  })

  it('should receive no txs in db by address (bad range)', async () => {
    const res = await client.execute('getaddresstxids', [{
      addresses: [addresses[1].toString()],
      start: 3
    }])
    assert(!res.length)
  })

  it('should receive many txs for many addresses', async () => {
    await sendTransaction() 
    await mineBlock()
    const res = await client.execute('getaddresstxids', [{
      addresses: [
        addresses[1].toString(),
        addresses[2].toString()
      ],
      start: 0
    }])
    assert(res[0] === txs[0].rhash().toString('hex'))
    assert(res[1] === txs[1].rhash().toString('hex'))
  })

  it('should cleanup', async () => {
    consensus.COINBASE_MATURITY = 100
    await node.close()
  })
})
