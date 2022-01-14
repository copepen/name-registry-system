require("dotenv-extended").load();

import "@nomiclabs/hardhat-waffle";
import "@nomiclabs/hardhat-etherscan";
import "@openzeppelin/hardhat-upgrades";
import "hardhat-contract-sizer";
import "@nomiclabs/hardhat-web3";

if (!process.env.MAINNET_PRIVKEY)
  throw new Error("MAINNET_PRIVKEY missing from .env file");

const config = {
  defaultNetwork: "rinkeby",
  networks: {
    hardhat: {
      forking: {
        url: `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_KEY}`,
        blockNumber: 11589707,
      },
    },
    mainnet: {
      chainId: 1,
      url: `https://mainnet.infura.io/v3/${process.env.INFURA_MAINNET_KEY}`,
      accounts: [process.env.MAINNET_PRIVKEY],
    },
    rinkeby: {
      chainId: 4,
      url: `https://rinkeby.infura.io/v3/${process.env.INFURA_RINKEBY_KEY}`,
      gasPrice: 200000000000,
      accounts: [process.env.RINKEBY_PRIVKEY],
    },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API,
  },
  paths: {
    artifacts: "./artifacts",
    cache: "./cache",
    sources: "./contracts",
    tests: "./tests",
  },
  solidity: {
    compilers: [
      {
        version: "0.8.4",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
  mocha: {
    timeout: 2000000000,
  },
  typechain: {
    outDir: "types/contracts",
    target: "truffle-v5",
  },
};

export default config;
