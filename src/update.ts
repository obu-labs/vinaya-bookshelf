import { Notice, requestUrl, Platform, normalizePath } from "obsidian";
import VinayaNotebookPlugin from "./main";
import { hashForFolder } from "./hashutils";
import downloadZip from "./downloadZip";
import confirmationModal from "./confirmationmodal";
import { statsForFolder } from "./fileutils";
import { assert, getKeyWithValue } from "./helpers";

const CANONICAL_VNM_LIST_URL = "https://labs.buddhistuniversity.net/vinaya/canonicalvnms.json";

export type FolderName = string;
export type URLString = string;

export interface SubmoduleMetadata {
  name: string;
  paths: string[];
  requires: Record<string, any>;
};

const VNMMetadataShape = {
  folder: 'string', // The folder name as realized
  more_info: 'string', // Link to learn about this folder
  description: 'string', // Description of the folder
  version: 'string', // Latest version in MAJOR.MINOR.PATCH format
  requires: 'object', // Mapping of other folder to its subfolders (recursive)
  zip: 'string', // URL of the zip containing the folder's contents
  submodules: 'array', // A list of Submodules
} as const;

export type VNMMetadata = {
  [K in keyof typeof VNMMetadataShape as typeof VNMMetadataShape[K] extends 'array' ? never : K]:
    typeof VNMMetadataShape[K] extends 'string' ? string :
    typeof VNMMetadataShape[K] extends 'object' ? Record<string, Record<string, any>> :
    never;
} & {
  // Mark the 'array' fields as optional
  // Can replace Array<SubmoduleMetadata> with Record<string, any>[] if we ever have multiple array fields
  [K in keyof typeof VNMMetadataShape as typeof VNMMetadataShape[K] extends 'array' ? K : never]?: Array<SubmoduleMetadata>;
};

/**
 * 
 * @param url The URL of the VNM manifest file to download
 * @throw Error if the URL is bad or returns data in the wrong form
 * @returns The VNM metadata
 */
export async function fetch_vnm(url: string): Promise<VNMMetadata> {
  const response = await requestUrl(url);
  const metadata: any = response.json;
  assert(typeof metadata === "object", "VNMs are JSON objects");
  for (const [key, value] of Object.entries(VNMMetadataShape)) {
    if (value === 'array') {
      if (metadata[key]) { // array values are optional
        assert(Array.isArray(metadata[key]), `${key} must be an array`);
        for (const item of metadata[key]) {
          assert(typeof item === 'object', `${key} must be an array of objects`);
        }
      }
    } else {
      assert(typeof metadata[key] === value, `${key} must be a(n) ${value}`);
    }
  }
  return metadata;
}

export interface InstalledFolderRecord {
  version: string;
  hash: string;
}

class BaseDatumUpdater {
  plugin: VinayaNotebookPlugin;
  constructor(plugin: VinayaNotebookPlugin) {
    this.plugin = plugin;
  }

  get_id(): string {
    return "";
  }

  data_is_incomplete(): boolean {
    return false;
  }

  /**
   * The logic for actually doing the update.
   * 
   * @returns true if it would like to save the plugin's data
   */
  async perform_update(): Promise<boolean> {
    return false;
  }

  check_how_often(): number { // in Days
    return 7;
  }

  get_last_updated_time(): number {
    const data = this.plugin.data.lastUpdatedTimes[this.get_id()];
    if (!data) {
      return 0;
    }
    return data;
  }

  get_days_since_last_updated(): number {
    return (Date.now() - this.get_last_updated_time()) / (1000 * 60 * 60 * 24);
  }

  is_expired(): boolean {
    return this.get_days_since_last_updated() > this.check_how_often();
  }

  needs_update(): boolean {
    return this.is_expired() || this.data_is_incomplete();
  }

  async update() {
    const success = await this.perform_update();
    if (success) {
      await this.register_update();
    } else {
      new Notice(`Error updating ${this.get_id()}`);
    }
  }

  async register_update() {
    this.plugin.data.lastUpdatedTimes[this.get_id()] = Date.now();
    // In case the user is looking at the version info in the settings tab
    this.plugin.settingsTab.refreshDisplay();
    await this.plugin.save();
  }
}

export class VNMListUpdater extends BaseDatumUpdater {
  get_id(): string {
    return "VNMList";
  }

  data_is_incomplete(): boolean {
    return Object.keys(this.plugin.data.canonicalVNMs).length === 0;
  }

  async perform_update() {
    try {
      const response = await requestUrl(CANONICAL_VNM_LIST_URL);
      const vnm_list: Record<FolderName, URLString> = response.json;
      assert(typeof vnm_list === "object", "VNM List is a JSON object");
      for (const [folder, url] of Object.entries(this.plugin.data.canonicalVNMs)) {
        if (vnm_list[folder]) continue; // The new list knows about this old folder (the usual case)

        // If the old folder isn't known to the new list...
        delete this.plugin.data.knownFolders[folder];
        const extant_folder = this.plugin.app.vault.getFolderByPath(folder);
        const new_folder_name = getKeyWithValue(vnm_list, url);
        if (new_folder_name) {
          if (this.plugin.data.installedFolders[folder]) {
            this.plugin.data.installedFolders[new_folder_name] = this.plugin.data.installedFolders[folder];
            delete this.plugin.data.installedFolders[folder];
            if (extant_folder) {
              await this.plugin.app.vault.adapter.rename(folder, new_folder_name);
            }
          }
          if (this.plugin.data.folderOptOuts.contains(folder)) {
            this.plugin.data.folderOptOuts.remove(folder);
            this.plugin.data.folderOptOuts.push(new_folder_name);
          }
        } else {
          if (extant_folder) {
            const user_wants_folder_gone = await confirmationModal(
              "A Module is no longer available",
              `The module "${folder}" is no longer listed online. Would you like to delete the old folder? (If the folder has simply moved, please select yes.)`,
              this.plugin.app,
              `Delete "${folder}"`,
              "Keep it as an untracked folder",
            );
            if (user_wants_folder_gone) {
              await this.plugin.app.fileManager.trashFile(extant_folder);
              new Notice(`"${folder}" has been deleted.`);
            }
          }
        }
      }
      this.plugin.data.canonicalVNMs = vnm_list;
      return true;
    } catch (e) {
      console.error(e);
      new Notice(`Error updating the Canonical VNM List. No connection?`);
    }
    return false;
  }
}

export class VNMUpdater extends BaseDatumUpdater {
  folder_name: string;
  constructor(plugin: VinayaNotebookPlugin, folder_name: string) {
    super(plugin);
    this.folder_name = folder_name;
  }
  
  get_id(): string {
    return (this.folder_name + " VNM");
  }

  data_is_incomplete(): boolean {
    return !this.plugin.data.knownFolders[this.folder_name];
  }

  async perform_update(): Promise<boolean> {
    const vnm_url = this.plugin.data.canonicalVNMs[this.folder_name] || this.plugin.data.userVNMs[this.folder_name];
    try {
      const metadata: VNMMetadata = await fetch_vnm(vnm_url);
      if (metadata.folder !== this.folder_name) {
        if (this.plugin.data.canonicalVNMs[this.folder_name]) {
          throw new Error(`The expected folder name "${this.folder_name}" didn't match the VNM's name of "${metadata.folder}"`);
        } 
        if (!this.plugin.data.userVNMs[this.folder_name]) {
          throw new Error(`Where did ${this.folder_name} come from if not canonical or user?`);
        }
        // This is a user-added folder that has been renamed
        new Notice(`Renaming "${this.folder_name}" to "${metadata.folder}"...`);
        this.plugin.data.userVNMs[metadata.folder] = vnm_url;
        delete this.plugin.data.userVNMs[this.folder_name];
        const extant_folder = this.plugin.app.vault.getFolderByPath(this.folder_name);
        const installation = this.plugin.data.installedFolders[this.folder_name];
        const optedOut = this.plugin.data.folderOptOuts.contains(this.folder_name);
        delete this.plugin.data.installedFolders[this.folder_name];
        const target_folder = this.plugin.app.vault.getFolderByPath(metadata.folder);
        if (extant_folder) {
          let move_it = true;
          if (target_folder) {
            const overwrite_ok = await confirmationModal(
              "Folder already exists",
              `Attempting to rename "${this.folder_name}" to "${metadata.folder}", the folder "${metadata.folder}" was found to already exist! Would you like to overwrite it with the contents of "${this.folder_name}"?`,
              this.plugin.app,
              `Delete "${metadata.folder}"`,
              `Keep "${this.folder_name}" and "${metadata.folder}"`,
            );
            if (overwrite_ok) {
              await this.plugin.app.fileManager.trashFile(target_folder);
            } else {
              move_it = false;
            }
          }
          if (move_it) {
            this.plugin.data.installedFolders[metadata.folder] = installation;
            await this.plugin.app.vault.adapter.rename(this.folder_name, metadata.folder);
          }
        }
        if (optedOut) {
          this.plugin.data.folderOptOuts.remove(this.folder_name);
          this.plugin.data.folderOptOuts.push(metadata.folder);
        }
        delete this.plugin.data.knownFolders[this.folder_name];
        this.folder_name = metadata.folder;
      }
      this.plugin.data.knownFolders[this.folder_name] = metadata;
    } catch (e) {
      console.error(e);
      return false;
    }
    return true;
  }
}

export class FolderUpdater extends BaseDatumUpdater {
  folder_name: string;
  warn_about_overwrites: boolean;
  constructor(plugin: VinayaNotebookPlugin, folder_name: string) {
    super(plugin);
    this.folder_name = folder_name;
    // If the user of class really knows what they're doing,
    // they can reach in and set this to false.
    this.warn_about_overwrites = true;
  }

  check_how_often(): number {
    return 0; // We already know we're on the old version
  }

  get_id(): string {
    // The timestamp of the Folder install.
    return (this.folder_name + " Folder");
    // The timestamp of the "ask me later" is this + " Punted"
  }

  is_installed(): boolean {
    return !!this.plugin.data.installedFolders[this.folder_name];
  }

  is_at_latest_version(): boolean {
    if (!this.is_installed()) {
      return false;
    }
    return this.plugin.data.installedFolders[this.folder_name].version === this.plugin.data.knownFolders[this.folder_name].version;
  }

  data_is_incomplete(): boolean {
    return !this.is_installed() || !this.is_at_latest_version();
  }

  is_expired(): boolean {
    if (this.warn_about_overwrites) {
      const puntedTime = this.plugin.data.lastUpdatedTimes[this.get_id() + " Punted"];
      if (puntedTime) {
        return Date.now() > puntedTime + (24 * 60 * 60 * 1000);
      }
    }
    return true;
  }

  async subscribe() {
    let subbed = false;
    if (this.plugin.data.folderOptOuts.contains(this.folder_name)) {
      this.plugin.data.folderOptOuts.remove(this.folder_name);
      await this.plugin.save();
      subbed = true;
    }
    if (this.needs_update()) {
      await this.update();
    } else {
      if (subbed) {
        new Notice(`Will keep "${this.folder_name}" up-to-date!`);
      }
    }
  }

  async unsubscribe(silently?: boolean) {
    if (!this.plugin.data.folderOptOuts.contains(this.folder_name)) {
      this.plugin.data.folderOptOuts.push(this.folder_name);
      await this.plugin.save();
    }

    const folder = this.plugin.app.vault.getFolderByPath(normalizePath(this.folder_name));
    if (folder && !silently) {
      const message_fragment = new DocumentFragment();
      message_fragment.createEl("p", {
        text: "Vinaya Notebook will no longer download updates for this module. Would you also like to delete the folder?"
      });
      const dependents = this.plugin.installed_modules_relying_on(this.folder_name);
      if (dependents.length > 0) {
        message_fragment.createEl("p", {
          text: `This module is currently being referenced by ${dependents.length} other module${dependents.length === 1 ? "" : "s"}:`
        });
        const ul = message_fragment.createEl("ul");
        for (const dependent of dependents) {
          ul.createEl("li", {
            text: dependent
          });
        }
        message_fragment.createEl("p", {
          text: "If you delete this folder, some links in these modules will stop working."
        })
      }
      const user_wants_it_gone = await confirmationModal(
        "You are unsubscribed!",
        message_fragment,
        this.plugin.app,
        `Delete the "${folder.name}" folder now`,
        "Keep the folder",
      );
      if (user_wants_it_gone) {
        await this.plugin.app.fileManager.trashFile(folder);
        if (this.is_installed()) {
          delete this.plugin.data.installedFolders[this.folder_name];
          await this.plugin.save();
        }
        new Notice(`The "${folder.name}" folder has been trashed.`);
      } else {
        new Notice(`Will keep "${folder.name}" but will no longer keep it up-to-date.`);
      }
    } else {
      // The folder doesn't exist, but still double check that
      // we've cleared the installation metadata.
      // This can happen if the user deleted the folder manually in the OS.
      if (this.is_installed()) {
        delete this.plugin.data.installedFolders[this.folder_name];
        await this.plugin.save();
      }
      if (!silently) {
        new Notice(`Unsubscribed from "${this.folder_name}".`);
      }
    }
  }

  subscribed(): boolean {
    return !this.plugin.data.folderOptOuts.contains(this.folder_name);
  }

  needs_update(): boolean {
    // Note that expiry here is a retry timeout not a frequency
    return this.data_is_incomplete() && this.is_expired() && this.subscribed();
  }

  async perform_update(): Promise<boolean> {
    const folder = this.plugin.app.vault.getFolderByPath(this.folder_name);
    if (this.warn_about_overwrites && folder) {
      let needs_warning = true;
      if (this.is_installed()) {
        const stats = statsForFolder(folder);
        if (Platform.isDesktop || stats.length < 600) { // small folder, check the hash
          const old_hash = this.plugin.data.installedFolders[this.folder_name].hash;
          const cur_hash = await hashForFolder(folder);
          if (cur_hash === old_hash) {
            needs_warning = false;
          }
        } else { // large folder on mobile, just check the stat.mtime
          const updatedtime = this.get_last_updated_time();
          const modifiedtime = Math.max(...stats.map(stat => stat.mtime));
          if (updatedtime + 3000 > modifiedtime) { // a little wiggle room for delayed writes
            needs_warning = false;
          }
        }
      }
      if (needs_warning) {
        const user_confirmed = await confirmationModal(
          `Update the "${this.folder_name}" folder?`,
          `The "${this.folder_name}" folder has a new version available, but the version you currently have may have been modified. If you install the new version, any changes you've made will be lost.`,
          this.plugin.app,
          "Overwite Changes",
          "Ask me again tomorrow",
        )
        if (!user_confirmed) {
          this.plugin.data.lastUpdatedTimes[this.get_id() + " Punted"] = Date.now();
          await this.plugin.save();
          return false; // didn't succeed
        }
      }
    }

    const original_notice = new Notice(`Installing new "${this.folder_name}" folder...`, 0);
    const vnm_data = this.plugin.data.knownFolders[this.folder_name];
    try {
      const hash = await downloadZip(
        vnm_data.zip,
        this.folder_name,
        this.plugin.app,
        original_notice
      );
      this.plugin.data.installedFolders[this.folder_name] = {
        version: vnm_data.version,
        hash: hash
      };
      new Notice(`"${this.folder_name}" v${vnm_data.version} successfully installed!`);
    } catch (e) {
      console.error(e);
      new Notice(`!! Failed to install "${this.folder_name}"!`, 10000);
    }
    return true;
  }
}
