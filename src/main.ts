import { Plugin, Notice, requestUrl } from "obsidian";

import { hashForFolder } from "./hashutils";
import { downloadZip } from "./fileutils";

interface VNMMetadata {
  folder: string; // The folder name as realized
  more_info: string; // Link to learn about this folder
  version: string; // Latest version in MAJOR.MINOR.PATCH format
  requires: Record<string, string>; // Mapping of other folder to version
  zip: string; // URL of the zip containing the folder's contents
}

interface InstalledFolderRecord {
  version: string;
  hash: string;
}

interface VNPluginData {
  knownFolders: Record<string, VNMMetadata>; // Mapping of folder name to VNM metadata
  lastUpdatedMetadata: number; // timestamp of last update
  installedFolders: Record<string, InstalledFolderRecord>;
}

const DEFAULT_DATA: VNPluginData = {
  knownFolders: {},
  lastUpdatedMetadata: 0,
  installedFolders: {},
};

const CHECK_EVERY_N_DAYS = 7;

export default class VinayaNotebookPlugin extends Plugin {
  data: VNPluginData;

  async onload() {
    this.data = Object.assign({}, DEFAULT_DATA, await this.loadData());
    const daysSinceLastUpdate = (Date.now() - this.data.lastUpdatedMetadata) / (1000 * 60 * 60 * 24);

    if (this.incomplete_data() || daysSinceLastUpdate > CHECK_EVERY_N_DAYS) {
      setTimeout(async () => {
        await this.get_latest_data_from_the_cloud();
      }, 1000); // Wait until after the plugin is loaded to not lock up the UI
    }
  }

  async get_latest_data_from_the_cloud() {
    new Notice("Fetching latest note data...");
    const response = await requestUrl("https://github.com/obu-labs/brahmali-vinaya-notes/releases/latest/download/brahmali.vnm");
    const metadata: VNMMetadata = response.json;
    this.data.knownFolders["Ajahn Brahmali"] = metadata;
    this.data.lastUpdatedMetadata = Date.now();
    if (!this.data.installedFolders["Ajahn Brahmali"] || this.data.installedFolders["Ajahn Brahmali"].version !== metadata.version) {
      const folder = this.app.vault.getFolderByPath(metadata.folder);
      if (this.data.installedFolders["Ajahn Brahmali"] && folder) {
        const old_hash = this.data.installedFolders["Ajahn Brahmali"].hash;
        const cur_hash = await hashForFolder(folder);
        if (cur_hash !== old_hash) {
          // TODO replace this notice with a real modal dialog
          new Notice("!! OVERWRITING CHANGED DATA !!");
        }
      }
      const hash = await downloadZip(metadata.zip, metadata.folder, this.app);
      this.data.installedFolders["Ajahn Brahmali"] = {
        version: metadata.version,
        hash: hash
      };
    }
    await this.saveData(this.data);
    new Notice("Updated!");
  }

  incomplete_data() {
    return !this.data.knownFolders["Ajahn Brahmali"] || !this.data.installedFolders["Ajahn Brahmali"];
  }
}
