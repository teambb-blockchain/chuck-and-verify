require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    hardhat: {},
    didlab: {
      url: process.env.DIDLAB_RPC_URL || "https://eth.didlab.org",
      chainId: 252501,
      accounts: process.env.DIDLAB_PRIVATE_KEY
        ? [process.env.DIDLAB_PRIVATE_KEY]
        : [],
    },
  },
};
