# bcoin-bitcore-node-compatibility-layer
### A bcoin plugin that adds rpc methods required by bitcore-node

## Motivation

This plugin aims to provide enough functionality so [bitcore-node](https://github.com/bitpay/bitcore-node) may be able to use bcoin instead of [bitcoin-core](https://github.com/bitcoin/bitcoin).

## Usage 

Currently bcoin provides no funcionality to install and load global plugins, so in order to use this one you'll need to run it from a dedicated project directory:

```shell
mkdir mynode
cd mynode && npm init
npm install --save bcoin bcoin-bitcore-node-compatibility-layer
```

Then just create `index.js` with the following contents to load the node:

```js
const FullNode = require('bcoin/lib/node/fullnode')
const BitcoreNodeCompatibilityLayer = require('bcoin-bitcore-node-compatibility-layer')

const node = new FullNode({
  db: 'memory',
  indexTX: true,
  indexAddress: true
})

node.use(BitcoreNodeCompatibilityLayer)

node.open()
  .then(() => node.connect())
  .then(() => node.startSync())
```

The process to use it along `bitcore-node` will be shortly documented. 

## FAQ

1. Why the long name?

The functionality provided by this plugin will be split in the future across several smaller modules, I tend to use long, annoying names as a reminder.
