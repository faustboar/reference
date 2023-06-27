import * as dotenv from "dotenv";

import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-foundry";

require('dotenv').config();

const config: HardhatUserConfig = {
  solidity: "0.8.18",
};

export default config;

module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.13",
        optimizer: {
          enabled: true,
          runs: 999999
        },
      },
      {
        version: "0.8.9",
        optimizer: {
          enabled: false,
          runs: 200
        },
      },
      {
        version: "0.8.1",
        optimizer: {
          enabled: true,
          runs: 999999
        },
      },
    ],
  },
  networks: {
    mumbai: {
      url: "https://matic-mumbai.chainstacklabs.com",
      chainId: 80001,
      accounts: [process.env.LEGENDS_OF_VENARI_OWNER_KEY]
    },
    localhost: {
      url: "http://localhost:8545",
      chainId: 31337
    }
  },
  etherscan: {
    apiKey: {
      polygon: process.env.LEGENDS_OF_VENARI_POLYGONSCAN_API_KEY,
      polygonMumbai: process.env.LEGENDS_OF_VENARI_POLYGONSCAN_API_KEY,
    }
  },
  typechain: {
    externalArtifacts: [
      'node_modules/@openzeppelin/contracts/build/contracts/ERC20PresetMinterPauser.json',
      'node_modules/@openzeppelin/contracts/build/contracts/ERC721PresetMinterPauserAutoId.json'
    ]
  }
}
