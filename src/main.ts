import { App, Plugin, Notice, requestUrl } from "obsidian";
import * as JSZip from 'jszip';

async function downloadZip(url: string, targetFolder: string, app: App) {
  // Replaces `targetFolder` with the contents of the zip at `url`
  const response = await requestUrl(url);
  const zip = await JSZip.loadAsync(response.arrayBuffer);
  const folder = app.vault.getFolderByPath(targetFolder);
  if (folder) {
    await app.vault.delete(folder, true);
  }
  for (const [path, file] of Object.entries(zip.files)) {
    const fullPath = `${targetFolder}/${path}`;

    if (file.dir) {
      // Create the folder in the vault
      await app.vault.createFolder(fullPath).catch(() => {
        /* Folder might already exist */
      });
    } else {
      const content = await file.async('uint8array');

      // Ensure parent folders exist
      const folderPath = fullPath.split('/').slice(0, -1).join('/');
      if (folderPath) {
        await app.vault.createFolder(folderPath).catch(() => {
          /* Folder might already exist */
        });
      }

      await app.vault.createBinary(fullPath, content).catch((err: Error) => {
        console.error(`Failed to create file ${fullPath}:`, err);
      });
    }
  }
}

interface VNMMetadata {
  folder: string; // The folder name as realized
  more_info: string; // Link to learn about this folder
  version: string; // Latest version in MAJOR.MINOR.PATCH format
  requires: Record<string, string>; // Mapping of other folder to version
  zip: string; // URL of the zip containing the folder's contents
}

interface VNPluginData {
  knownFolders: Record<string, VNMMetadata>; // Mapping of folder name to VNM metadata
  lastUpdatedMetadata: number; // timestamp of last update
  installedFolders: Record<string, string>; // Maps folder name to version
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
    if (!this.data.installedFolders["Ajahn Brahmali"] || this.data.installedFolders["Ajahn Brahmali"] !== metadata.version) {
      new Notice(`Downloading new ${metadata.folder} note data...`);
      await downloadZip(metadata.zip, metadata.folder, this.app);
      this.data.installedFolders["Ajahn Brahmali"] = metadata.version;
    }
    await this.saveData(this.data);
    new Notice("Updated!");
  }

  incomplete_data() {
    return !this.data.knownFolders["Ajahn Brahmali"] || !this.data.installedFolders["Ajahn Brahmali"];
  }
}
