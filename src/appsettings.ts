import { App, normalizePath, Notice } from "obsidian";
import confirmationModal from "./confirmationmodal";
import VinayaBookshelfPlugin from "./main";

// 20 seconds polling interval is a balance between finding out immediately
// and not wasting system resources reading the file again and again
const SETTINGS_CHECK_INTERVAL = 20 * 1000;

const ENFORCED_APP_SETTINGS: Record<string, string | boolean> = {
  "newLinkFormat": "relative",
  "useMarkdownLinks": true,
  "newFileLocation": "folder",
};

export function recommended_app_settings(newFileFolderPath: string): Record<string, unknown> {
  return Object.assign({}, ENFORCED_APP_SETTINGS, {
    "propertiesInDocument": "visible",
    "spellcheck": false,
    "useTab": false,
    "tabSize": 4,
    "userIgnoreFilters": [
      ".git"
    ],
    "newFileFolderPath": newFileFolderPath,
    "attachmentFolderPath": `${newFileFolderPath}/attachments`
  });
}

export function is_settings_modal_open() {
  return document.getElementsByClassName("modal mod-settings").length > 0;
}

export function app_settings_path(app: App): string {
  const config_dir = app.vault.configDir;
  const app_settings_path = `${config_dir}/app.json`;
  return normalizePath(app_settings_path);
}

export async function get_app_settings(app: App): Promise<Record<string, unknown>> {
  const config_json = await app.vault.adapter.read(app_settings_path(app));
  let config: Record<string, unknown> = {};
  if (config_json) {
    config = JSON.parse(config_json);
  }
  return config;
}

export async function checkAppSettings(plugin: VinayaBookshelfPlugin) {
  if (is_settings_modal_open()) {
    plugin.settingsChecker = setTimeout(async () => {
      await checkAppSettings(plugin);
    }, 800); // Try again quickly as this is a cheap check
    return;
  }
  const config = await get_app_settings(plugin.app);
  if (typeof config["newFileFolderPath"] === "string") {
    plugin.personalFolderName = config["newFileFolderPath"];
  }
  const changed_settings: Map<string, string> = new Map<string, string>();
  for (const key in ENFORCED_APP_SETTINGS) {
    if (config[key] !== ENFORCED_APP_SETTINGS[key] && typeof config[key] === "string") {
      changed_settings.set(key, config[key]);
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
    for (const [setting_name] of changed_settings.entries()) {
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
    for (const [, bad_value] of changed_settings.entries()) {
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
      `It seems that ${settings_string} This may cause the notes that you take to become incompatible with other applications. Would you like to revert back to the recommended settings?`,
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
      app_settings_path(plugin.app),
      JSON.stringify(config, null, 2),
    );
    new Notice("Settings reverted successfully.");
  }
  plugin.settingsChecker = setTimeout(async () => {
    await checkAppSettings(plugin);
  }, SETTINGS_CHECK_INTERVAL);
}
