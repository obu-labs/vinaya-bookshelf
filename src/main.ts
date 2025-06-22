import { Plugin, Notice, requestUrl } from "obsidian";

import { 
  FolderUpdater,
  InstalledFolderRecord,
  VNMListUpdater,
  VNMMetadata,
  VNMUpdater
} from "./update";

interface VNPluginData {
  canonicalVNMs: Record<string, string>; // Maps folder name to VNM URL
  knownFolders: Record<string, VNMMetadata>; // Mapping of folder name to VNM metadata
  lastUpdatedTimes: Record<string, number>;
  installedFolders: Record<string, InstalledFolderRecord>;
}

const DEFAULT_DATA: VNPluginData = {
  canonicalVNMs: {},
  knownFolders: {},
  lastUpdatedTimes: {},
  installedFolders: {},
};

export default class VinayaNotebookPlugin extends Plugin {
  data: VNPluginData;

  async onload() {
    this.data = Object.assign({}, DEFAULT_DATA, await this.loadData());

    setTimeout(async () => {
      await this.initiate_background_update();
    }, 1000); // Wait until after the plugin is loaded to not lock up the UI
  }

  async save() {
    await this.saveData(this.data);
  }

  async initiate_background_update() {
    const root_updater = new VNMListUpdater(this);
    if (root_updater.needs_update()) {
      new Notice("Checking for new folders...");
      root_updater.update();
    }
    for (const folder_name of Object.keys(this.data.canonicalVNMs)) {
      const vnm_updater = new VNMUpdater(this, folder_name);
      if (vnm_updater.needs_update()) {
        new Notice(`Fetching "${folder_name}" metadata...`);
        vnm_updater.update();
      }
      const folder_updater = new FolderUpdater(this, folder_name);
      if (folder_updater.needs_update()) {
        new Notice(`Installing new "${folder_name}" folder...`);
        folder_updater.update();
      }
    }
  }
}
