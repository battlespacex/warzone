module.exports = {
  apps: [
    {
      name: "warzone-api",
      cwd: "C:\\websites\\warzone-worker\\warzone\\apps\\api",
      script: "cmd.exe",
      args: "/c npm start",
      autorestart: true
    },

    {
      name: "warzone-worker",
      cwd: "C:\\websites\\warzone-worker\\warzone\\apps\\worker",
      script: "cmd.exe",
      args: "/c npm start",
      autorestart: true
    },

    {
      name: "warzone-frontend",
      cwd: "C:\\websites\\warzone-worker\\warzone",
      script: "cmd.exe",
      args: "/c npm run serve",
      autorestart: true
    },

    {
      name: "reports",
      cwd: "C:\\websites\\warzone-worker\\warzone\\apps\\worker",
      script: "cmd.exe",
      args: "/c npm run reports:once -- --scope=global --force",
      autorestart: false
    },

    {
      name: "daalshaal",
      cwd: "C:\\websites\\daalshaal",
      script: "cmd.exe",
      args: "/c npm start",
      autorestart: true
    }
  ]
};
