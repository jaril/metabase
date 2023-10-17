const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const https = require("https");

const generateRandomString = (length = 6) => {
  const characters = "abcdefghijklmnopqrstuvwxyz";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
};

const runCommandWithEnv = (command, env = {}) => {
  console.log(`$ ${command}`);
  execSync(command, { stdio: "inherit", env: { ...process.env, ...env } });
};

const download = (url, destination) => {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(path.dirname(destination))) {
      reject(
        new Error(`Directory does not exist: ${path.dirname(destination)}`),
      );
      return;
    }
    const file = fs.createWriteStream(destination);
    https
      .get(url, response => {
        response.pipe(file);
        file.on("finish", () => {
          file.close(resolve);
        });
      })
      .on("error", err => {
        fs.unlink(destination);
        reject(err.message);
      });
  });
};

(async () => {
  try {
    runCommandWithEnv("yarn install");

    const currentDir = process.cwd();
    const recordReplayDir = path.join(currentDir, ".replay");
    process.env.RECORD_REPLAY_DIRECTORY = recordReplayDir;

    if (!fs.existsSync(path.join(recordReplayDir, "runtimes"))) {
      const ret = fs.mkdirSync(path.join(recordReplayDir, "runtimes"), {
        recursive: true,
      });
      console.log(`mkdir ret: ${ret}`);
    }
    if (!fs.existsSync(path.join(recordReplayDir, "runtimes"))) {
      throw new Error("Directory was not created successfully.");
    }
    console.log(
      `Directories created up to: ${path.join(recordReplayDir, "runtimes")}`,
    );

    console.log(
      `Directories created up to: ${path.join(recordReplayDir, "runtimes")}`,
    );

    const dmgFile = path.join(
      recordReplayDir,
      "runtimes",
      "Replay-Chromium.app.dmg",
    );
    await download(
      "https://static.replay.io/downloads/macOS-chromium-20230916-e7589a401ac1-4d0a9f5b9de2.dmg",
      dmgFile,
    );

    runCommandWithEnv(`hdiutil attach ${dmgFile}`);
    runCommandWithEnv(
      `cp -R /Volumes/Replay-Chromium/Replay-Chromium.app ${path.join(
        recordReplayDir,
        "runtimes",
        "Replay-Chromium.app",
      )}`,
    );
    runCommandWithEnv("hdiutil detach /Volumes/Replay-Chromium");

    const randomString = generateRandomString();

    const cleanup = () => {
      runCommandWithEnv(`fly apps destroy replay-mb-${randomString} -y`);
    };

    process.on("exit", cleanup);
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    runCommandWithEnv(
      `fly app create --name replay-mb-${randomString} -o replay`,
    );
    runCommandWithEnv(
      `fly deploy -a replay-mb-${randomString} -c fly.toml --vm-size shared-cpu-4x --ha=false`,
    );
    runCommandWithEnv(
      `yarn test-cypress-run --e2e --browser replay-chromium --folder collections`,
      {
        CYPRESS_REPLAYIO_ENABLED: "1",
        E2E_HOST: `https://replay-mb-${randomString}.fly.dev`,
        QA_DB_ENABLED: "false",
      },
    );

    runCommandWithEnv(
      "node_modules/.bin/replay metadata --init --keys source --warn",
    );

    const outputString = execSync("node_modules/.bin/replay ls").toString();
    console.log(`outputString: ${outputString}`);
    // grab first column of output
    const recordingIds = outputString
      .split("\n")
      .map(line => line.split(" ")[0]);
    // drop first element (header)
    recordingIds.shift();
    console.log("recordingIds", recordingIds);

    try {
      runCommandWithEnv("node_modules/.bin/replay upload-all");
    } catch (e) {
      console.log(`Error uploading all recordings: ${e}`);
      console.log("Continuing...");
    }

    // call replay process on each recording ID
    let errorProcessingRecording = false;
    recordingIds.forEach(recordingId => {
      try {
        runCommandWithEnv(`node_modules/.bin/replay process ${recordingId}`);
      } catch (e) {
        errorProcessingRecording = true;
        console.log(`Error processing recording ${recordingId}: ${e}`);
      }
    });

    if (errorProcessingRecording) {
      throw new Error("Error processing recording");
    }
  } catch (err) {
    console.error(err);
  }
})();