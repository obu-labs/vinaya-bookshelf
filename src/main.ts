import { App, Plugin, Notice, requestUrl, TFolder } from "obsidian";
import * as JSZip from 'jszip';

async function sha256(data: ArrayBufferLike): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hashForFileList(fileList: { path: string, hash: string }[]): Promise<string> {
  // Sort by paths so it's order agnostic
  fileList.sort((a, b) => a.path.localeCompare(b.path));
  
  // Combine all paths and hashes into a single string
  let combinedData = '';
  for (const { path, hash } of fileList) {
    combinedData += path + hash;
  }
  
  // Hash the combined data
  const combinedBuffer = new TextEncoder().encode(combinedData);
  return await sha256(combinedBuffer);
}

async function hashForFolder(folder: TFolder): Promise<string> {
  const fileList: { path: string, hash: string }[] = [];
  const folderList: TFolder[] = [];
  folderList.push(folder);

  while (folderList.length > 0) {
    const subfolder = folderList.shift();
    if (!subfolder) {
      continue;
    }
    for (const child of subfolder.children) {
      if (child instanceof TFolder) {
        folderList.push(child);
      } else {
        const content = await child.vault.adapter.readBinary(child.path);
        const hash = await sha256(content);
        fileList.push({ path: child.path, hash });
      }
    }
  }
  return await hashForFileList(fileList);
}

async function downloadZip(url: string, targetFolder: string, app: App) {
  // Replaces `targetFolder` with the contents of the zip at `url`
  // Returns an MD5 of the inflated directory's contents
  const response = await requestUrl(url);
  const zip = await JSZip.loadAsync(response.arrayBuffer);
  const folder = app.vault.getFolderByPath(targetFolder);
  const fileList: { path: string, hash: string }[] = [];
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
      const hash = await sha256(content);
      fileList.push({
        path: fullPath,
        hash: hash
      });
    }
  }

  return await hashForFileList(fileList);
}

interface VNMMetadata {
  folder: string; // The folder name as realized
  more_info: string; // Link to learn about this folder
  version: string; // Latest version in MAJOR.MINOR.PATCH format
  requires: Record<string, string>; // Mapping of other folder to version
  zip: string; // URL of the zip containing the folder's contents
}

interface InstalledFolderRecord {
  version: string;
  md5: string;
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
        const old_md5 = this.data.installedFolders["Ajahn Brahmali"].md5;
        const cur_md5 = await hashForFolder(folder);
        if (cur_md5 != old_md5) {
          // TODO replace this notice with a real modal dialog
          new Notice("!! OVERWRITING CHANGED DATA !!");
        }
      }
      const md5 = await downloadZip(metadata.zip, metadata.folder, this.app);
      this.data.installedFolders["Ajahn Brahmali"] = {
        version: metadata.version,
        md5: md5
      };
    }
    await this.saveData(this.data);
    new Notice("Updated!");
  }

  incomplete_data() {
    return !this.data.knownFolders["Ajahn Brahmali"] || !this.data.installedFolders["Ajahn Brahmali"];
  }
}
