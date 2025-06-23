import { normalizePath, Notice } from "obsidian";
import confirmationModal from "./confirmationmodal";
import VinayaNotebookPlugin from "./main";

// 20 seconds polling interval is a balance between finding out immediately
// and not wasting system resources reading the file again and again
const SETTINGS_CHECK_INTERVAL = 20 * 1000;

const ENFORCED_APP_SETTINGS: Record<string, any> = {
  "newLinkFormat": "relative",
  "useMarkdownLinks": true,
  "newFileLocation": "folder",
  /* TODO: get these from plugin settings
  "newFileFolderPath": newFileFolderPath,
  "attachmentFolderPath": `${newFileFolderPath}/attachments`
  */
}

export async function checkAppSettings(plugin: VinayaNotebookPlugin) {
  if (document.getElementsByClassName("modal mod-settings").length > 0) {
    // The settings panel is currently open
    // Check again soon
    console.log("Skipping check while settings open...")
    plugin.settingsChecker = setTimeout(async () => {
      await checkAppSettings(plugin);
    }, 800);
    return;
  }
  console.log("Checking settings...")
  const config_dir = plugin.app.vault.configDir;
  const app_settings_path = `${config_dir}/app.json`;
  let config_json = await plugin.app.vault.adapter.read(app_settings_path);
  let config: Record<string, any> = {};
  let changed_settings: Map<string, string> = new Map<string, string>();
  if (config) {
    config = JSON.parse(config_json);
  }
  for (const key in ENFORCED_APP_SETTINGS) {
    if (config[key] !== ENFORCED_APP_SETTINGS[key]) {
      changed_settings.set(key, config[key].toString());
      config[key] = ENFORCED_APP_SETTINGS[key];
    }
  }
  if (changed_settings.size > 0) {
    let settings_string = "your setting";
    if (changed_settings.size > 1) {
      settings_string += "s";
    }
    settings_string += ":";
    let i = 0;
    for (const [setting_name, bad_value] of changed_settings.entries()) {
      settings_string += ` "${setting_name}"`;
      if (changed_settings.size > 2) {
        settings_string += ",";
      }
      if (i == changed_settings.size - 2 && changed_settings.size >= 2) {
        settings_string += " and";
      }
      i += 1;
    }
    if (changed_settings.size > 1) {
      settings_string += " were";
    } else {
      settings_string += " was";
    }
    settings_string += " changed to";
    i = 0;
    for (const [setting_name, bad_value] of changed_settings.entries()) {
      settings_string += ` "${bad_value}"`;
      if (changed_settings.size > 2) {
        settings_string += ",";
      }
      if (i == changed_settings.size - 2 && changed_settings.size >= 2) {
        settings_string += " and";
      }
      i += 1;
    }
    if (changed_settings.size > 1) {
      settings_string += " respectively.";
    } else {
      settings_string += " from the default value of \"";
      settings_string += ENFORCED_APP_SETTINGS[changed_settings.keys().next().value];
      settings_string += ".\"";
    }
    const disable_checker = await confirmationModal(
      "You changed your vault settings",
      `It seems that ${settings_string} This may cause the notes that you take to become incompatible with other applications. Would you like to revert to the recommended settings?`,
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
