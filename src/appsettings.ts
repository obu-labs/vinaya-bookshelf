import { normalizePath, Notice } from "obsidian";
import confirmationModal from "./confirmationmodal";
import VinayaNotebookPlugin from "./main";

// 20 seconds polling interval is a balance between finding out immediately
// and not wasting system resources reading the file again and again
const SETTINGS_CHECK_INTERVAL = 20 * 1000;

const ENFORCED_APP_SETTINGS: Record<string, any> = {
  "newLinkFormat": "relative",
  "useMarkdownLinks": true,
}

export async function checkAppSettings(plugin: VinayaNotebookPlugin) {
  const config_dir = plugin.app.vault.configDir;
  const app_settings_path = `${config_dir}/app.json`;
  let config_json = await plugin.app.vault.adapter.read(app_settings_path);
  let config: Record<string, any> = {};
  let changed_settings: Array<string> = [];
  if (config) {
    config = JSON.parse(config_json);
  }
  for (const key in ENFORCED_APP_SETTINGS) {
    if (config[key] !== ENFORCED_APP_SETTINGS[key]) {
      config[key] = ENFORCED_APP_SETTINGS[key];
      changed_settings.push(key);
    }
  }
  if (changed_settings.length > 0) {
    let settings_string = "your setting";
    if (changed_settings.length > 1) {
      settings_string += "s";
    }
    settings_string += ":";
    for (let i = 0; i < changed_settings.length; i++) {
      const setting_name = changed_settings[i];
      settings_string += ` "${setting_name}"`;
      if (changed_settings.length > 2) {
        settings_string += ",";
      }
      if (i == changed_settings.length - 2 && changed_settings.length >= 2) {
        settings_string += " and";
      }
    }
    if (changed_settings.length > 1) {
      settings_string += " were changed";
    } else {
      settings_string += " was changed";
    }
    const disable_checker = await confirmationModal(
      "You changed your vault settings",
      `It seems that ${settings_string} from the defaults. This may cause the notes that you take to become incompatible with other applications. Would you like to revert to the recommended settings?`,
      plugin.app,
      "Stop Checking Compatibility",
      "Revert Settings to Safer Defaults",
    );
    if (disable_checker) {
      plugin.data.disabledSettingsCheck = Date.now();
      await plugin.save();
      new Notice("Settings checker disabled.");
      return;
    }
    await plugin.app.vault.adapter.write(
      normalizePath(app_settings_path),
      JSON.stringify(config),
    );
    new Notice("Settings reverted successfully.");
  }
  plugin.settingsChecker = setTimeout(async () => {
    await checkAppSettings(plugin);
  }, SETTINGS_CHECK_INTERVAL);
}
