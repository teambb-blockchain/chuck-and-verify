require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    hardhat: {},
    didlab: {
      url: process.env.DIDLAB_RPC || "https://eth.didlab.org",
      chainId: 252501,
      accounts: process.env.DEPLOYER_KEY
        ? [process.env.DEPLOYER_KEY]
        : [],
    },
  },
};
