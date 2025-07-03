import { Notice, Plugin } from "obsidian";

import { 
  FolderName,
  URLString,
  FolderUpdater,
  InstalledFolderRecord,
  VNMListUpdater,
  VNMMetadata,
  VNMUpdater
} from "./update";
import {
  checkAppSettings,
} from "./appsettings";
import openNuxModelWhenReady from "./nux";

interface VNPluginData {
  canonicalVNMs: Record<FolderName, URLString>;
  knownFolders: Record<FolderName, VNMMetadata>;
  lastUpdatedTimes: Record<string, number>;
  installedFolders: Record<FolderName, InstalledFolderRecord>;
  disabledSettingsCheck: number; // TODO Add a toggle in the settings panel
  nuxShown: number;
}

const DEFAULT_DATA: VNPluginData = {
  canonicalVNMs: {},
  knownFolders: {},
  lastUpdatedTimes: {},
  installedFolders: {},
  disabledSettingsCheck: 0,
  nuxShown: 0,
};

export default class VinayaNotebookPlugin extends Plugin {
  data: VNPluginData;
  settingsChecker: any;

  async onload() {
    this.data = Object.assign({}, DEFAULT_DATA, await this.loadData());

    // Defer checks until everything is loaded
    setTimeout(async () => {
      if (!this.data.nuxShown) {
        new Notice("The Vinaya Notebook Plugin is Enabled!");
        if (!Object.entries(this.data.canonicalVNMs).length) {
          // Initialize with a basic set in case the canonical url is down
          this.data.canonicalVNMs =  {
            "Ajahn Brahmali": "https://github.com/obu-labs/brahmali-vinaya-notes/releases/latest/download/manifest.vnm",
            "Canon (Pali)": "https://github.com/obu-labs/pali-vinaya-notes/releases/latest/download/manifest.vnm",
            "Bhante Suddhaso": "https://github.com/obu-labs/suddhaso-vinaya-notes/releases/latest/download/manifest.vnm",
          };
          await this.save();
        }
      }
      await this.initiate_background_update();
      if (!this.data.nuxShown) {
        await openNuxModelWhenReady(this);
      }
    }, 500);
  }

  onunload() {
    clearTimeout(this.settingsChecker);
  }

  async save() {
    await this.saveData(this.data);
  }

  async initiate_background_update() {
    const root_updater = new VNMListUpdater(this);
    if (root_updater.needs_update()) {
      await root_updater.update();
    }

    const updatePromises: Promise<void>[] = [];
    for (const folder_name in this.data.canonicalVNMs) {
      const vnm_updater = new VNMUpdater(this, folder_name);
      if (vnm_updater.needs_update()) {
        updatePromises.push(vnm_updater.update());
      }
    }
    await Promise.all(updatePromises);
    
    if (!this.data.nuxShown) {
      return; // Let the NUX handle the rest
    }
    
    if (!this.data.disabledSettingsCheck) {
      await checkAppSettings(this);
    }

    const downloadPromises: Promise<void>[] = [];
    for (const folder_name in this.data.canonicalVNMs) {
      const folder_updater = new FolderUpdater(this, folder_name);
      if (folder_updater.needs_update()) {
        downloadPromises.push(folder_updater.update());
      }
    }
    await Promise.all(downloadPromises);
  }
}
