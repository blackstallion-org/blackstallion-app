const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SWIFT_FILENAME = 'ExcludeOutboxFromBackup.swift';

const SWIFT_SOURCE = `
import Foundation

enum OutboxBackupExclusion {
    static let dbName = "bsah-outbox.db"

    static func excludeIfNeeded() {
        guard let documentsURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
        let candidates = [
            documentsURL.appendingPathComponent("SQLite/\\(dbName)"),
            documentsURL.appendingPathComponent(dbName),
        ]
        for fileURL in candidates {
            guard FileManager.default.fileExists(atPath: fileURL.path) else { continue }
            var resourceValues = URLResourceValues()
            resourceValues.isExcludedFromBackup = true
            var mutable = fileURL
            try? mutable.setResourceValues(resourceValues)

            for suffix in ["-wal", "-shm"] {
                let sidecar = fileURL.appendingPathExtension(suffix.replacingOccurrences(of: "-", with: ""))
                guard FileManager.default.fileExists(atPath: sidecar.path) else { continue }
                var sidecarMutable = sidecar
                var sv = URLResourceValues()
                sv.isExcludedFromBackup = true
                try? sidecarMutable.setResourceValues(sv)
            }
        }
    }
}
`;

function withIosBackupExclusion(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const iosDir = path.join(cfg.modRequest.platformProjectRoot);
      const projectName = cfg.modRequest.projectName || cfg.name || 'bsahmobile';
      const targetDir = path.join(iosDir, projectName);

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      fs.writeFileSync(path.join(targetDir, SWIFT_FILENAME), SWIFT_SOURCE.trim() + '\n');

      const appDelegatePath = path.join(targetDir, 'AppDelegate.swift');
      if (fs.existsSync(appDelegatePath)) {
        let content = fs.readFileSync(appDelegatePath, 'utf8');
        const callSite = 'OutboxBackupExclusion.excludeIfNeeded()';
        if (!content.includes(callSite)) {
          content = content.replace(
            /(func application\([^)]*didFinishLaunchingWithOptions[^)]*\)[^{]*\{)/,
            `$1\n    ${callSite}`,
          );
          fs.writeFileSync(appDelegatePath, content);
        }
      }

      return cfg;
    },
  ]);
}

module.exports = withIosBackupExclusion;
