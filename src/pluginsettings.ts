import { normalizePath, Notice, PluginSettingTab, Setting, displayTooltip } from "obsidian";
import VinayaBookshelfPlugin from "./main";
import { fetch_vnm, FolderUpdater, VNMMetadata } from "./update";
import * as dayjs from "dayjs";
import * as relativeTime from "dayjs/plugin/relativeTime";
import { isUrl } from "./helpers";
import confirmationModal from "./confirmationmodal";
import NewModuleModal from "./newmodulemodal";
import { hashForFolder } from "./hashutils";

function isPluginFunc(value: unknown): value is dayjs.PluginFunc {
  return typeof value === "function";
}

const plugin = isPluginFunc(relativeTime)
  ? relativeTime
  : isPluginFunc((relativeTime as Record<string, unknown>).default)
    ? (relativeTime as { default: dayjs.PluginFunc }).default
    : undefined;

if (!plugin) {
  throw new Error("Invalid dayjs plugin import");
}

dayjs.extend(plugin);

export class VinayaBookshelfSettingsTab extends PluginSettingTab {
  plugin: VinayaBookshelfPlugin;
  is_updating: boolean;
  is_foregrounded: boolean;
  custom_url_input: HTMLInputElement;
  custom_url_button: HTMLButtonElement;

  constructor(plugin: VinayaBookshelfPlugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
    this.is_updating = false;
    this.is_foregrounded = false;
  }

  setIsUpdating(is_updating: boolean) {
    this.is_updating = is_updating;
    this.refreshDisplay();
  }

  hide(): void {
    this.is_foregrounded = false;
    super.hide();
  }

  refreshDisplay(): void {
    if (this.is_foregrounded) {
      this.display();
    }
  }

  display(): void {
    this.is_foregrounded = true;
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Force Update')
      .setDesc(createFragment(
        (fragment) => {
          if (this.is_updating) {
            const text = document.createElement('span');
            text.setText('Updating now...');
            fragment.append(text);
          } else {
            const text1 = document.createElement('span');
            text1.setText('Last updated ');
            fragment.append(text1);
            const text2 = document.createElement('span');
            const lastTime = this.plugin.last_updated_time();
            if (lastTime === Infinity) {
              text2.setText('Never');
              fragment.append(text2);
            } else {
              const relativeTime = dayjs.unix(lastTime/1000).fromNow();
              text2.setText(relativeTime);
              fragment.append(text2);
            }
          }
        }
      ))
      .addButton((btn) => {
        if (this.is_updating) {
          btn.setDisabled(true);
          btn.setClass('loading-spinner');
        } else {
          btn.setButtonText('Update Now');
          btn.onClick(() => {
            this.plugin.force_update();
          });
        }
      });
    
    new Setting(containerEl).setHeading().setName("Module subscriptions")
      .setDesc("Toggle any module off to stop receiving updates for it.");
    
    const feedSection = containerEl.createDiv({ cls: "module-settings-section" });    
    // feedSection.createEl("h3", { text: "Manage Module Subscriptions" });
    Object.entries(this.plugin.data.knownFolders)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .forEach(([name, vnmdata]) => {
        const moduleEl = feedSection.createDiv({ cls: "module-settings" });
        const updater = new FolderUpdater(this.plugin, name);
        const moduleFolder = this.app.vault.getFolderByPath(name);
        const setting = new Setting(moduleEl)
          .setName(name);
        if (this.plugin.data.userVNMs[name]) {
          setting.addExtraButton((btn) => {
            btn.setIcon("trash");
            btn.onClick(async () => {
              const confirm_message = new DocumentFragment();
              confirm_message.createEl("p", { text: "Deleting this custom module will unsubscribe you from it. You can always add it back again later by adding its URL:" });
              const input = confirm_message.createEl("input", {
                attr: {
                  type: "text",
                  value: this.plugin.data.userVNMs[name],
                  readonly: true,
                },
                cls: "fullwidth",
              });
              console.log(input);
              input.addEventListener("focus", () => {
                input.select();
              });
              const user_wants_it_gone = await confirmationModal(
                `Are you sure you want to delete "${name}"?`,
                confirm_message,
                this.plugin.app,
                "Unsubscribe and Forget",
                "Cancel"
              );
              if (!user_wants_it_gone) {
                return;
              }
              await updater.unsubscribe();
              delete this.plugin.data.userVNMs[name];
              delete this.plugin.data.knownFolders[name];
              await this.plugin.save();
              this.refreshDisplay();
            });
          })
        }
        setting.addToggle((toggle) => {
          toggle
            .setValue(updater.subscribed())
            .onChange((value) => {
              // Explicitly changing subscription resets the punt time
              delete this.plugin.data.lastUpdatedTimes[name + " Folder Punted"];
              if (value) {
                updater.subscribe().then(() => {
                  this.refreshDisplay();
                });
              } else {
                updater.unsubscribe().then(() => {
                  this.refreshDisplay();
                });
              }
            });
          });
        const descEl = setting.descEl.createDiv({ cls: "module-settings-desc" });
        const metaEl = descEl.createEl("p", { text: `Version: ${vnmdata.version}` });
        if (this.plugin.data.installedFolders[name] && vnmdata.version !== this.plugin.data.installedFolders[name].version) {
          metaEl.createSpan({ text: ` (Installed: ${this.plugin.data.installedFolders[name].version})` });
        }
        if (vnmdata.more_info.startsWith("http")) {
          metaEl.createSpan({ text: " • " });
          metaEl.createEl("a", { text: "Source", href: vnmdata.more_info });
        }
        descEl.createEl("p", { text: vnmdata.description });
        if (updater.subscribed() && vnmdata.submodules && vnmdata.submodules.length > 0) {
          const submodulesEl = moduleEl.createDiv({ cls: "submodules", text: "Submodules:" });
          vnmdata.submodules.forEach((submodule) => {
            const submoduleEl = submodulesEl.createDiv({ cls: "submodule" });
            const isOptedOut = this.plugin.data.folderOptOuts.contains(`${name}/${submodule.name}`);
            const submoduleSetting = new Setting(submoduleEl)
              .setName("↳ " + submodule.name);
            if (moduleFolder) {
              submoduleSetting.addButton((btn) => {
                if (isOptedOut) {
                  btn
                    .setIcon("download")
                    .onClick(async () => {
                      this.plugin.data.folderOptOuts.remove(`${name}/${submodule.name}`);
                      btn.setButtonText("");
                      btn.buttonEl.addClass("loading-spinner");
                      await updater.update();
                      this.refreshDisplay();
                    });
                } else {
                  btn
                    .setIcon("trash")
                    .onClick(async () => {
                      const reliant_modules = this.plugin.installed_modules_relying_on_submodule(name, submodule);
                      if (reliant_modules.length > 0) {
                        const warning_body = new DocumentFragment();
                        warning_body.createEl("p", {
                          text: "The following modules contain links which reference this submodule:"
                        });
                        const ul = warning_body.createEl("ul");
                        for (const reliant_module of reliant_modules) {
                          ul.createEl("li", {
                            text: reliant_module
                          });
                        }
                        warning_body.createEl("p", {
                          text: "Removing this submodule will break whatever links in those modules refer to it. Are you sure you want to continue?"
                        })
                        const ignore_reliant_modules = await confirmationModal(
                          "Warning: Some modules reference this submodule",
                          warning_body,
                          this.plugin.app,
                          `Delete "${submodule.name}"`,
                          "Cancel"
                        );
                        if (!ignore_reliant_modules) {
                          return;
                        }
                      }
                      btn.setButtonText("");
                      btn.buttonEl.addClass("loading-spinner");
                      const notice = new Notice(`Uninstalling "${name} > ${submodule.name}"...`, 0);
                      const currentFolderHash = await hashForFolder(moduleFolder);
                      if (currentFolderHash !== this.plugin.data.installedFolders[name].hash) {
                        const continue_with_uninstall = await confirmationModal(
                          "Remove possibly modified submodule?",
                          "This module has been modified since it was initially installed. Are you sure you want to uninstall \""+submodule.name+"\"?",
                          this.plugin.app,
                          "Delete \""+submodule.name+"\"",
                          "Cancel"
                        );
                        if (!continue_with_uninstall) {
                          btn.buttonEl.removeClass("loading-spinner");
                          btn.setIcon("trash");
                          notice.hide();
                          return;
                        }
                      }
                      for (const subfolder of submodule.paths) {
                        const tsub = this.app.vault.getFolderByPath(normalizePath(`${name}/${subfolder}`));
                        if (tsub) {
                          notice.setMessage(`Uninstalling "${name}/${subfolder}"...`);
                          await this.app.fileManager.trashFile(tsub);
                        }
                      }
                      notice.setMessage(`Uninstalling "${name} > ${submodule.name}"...`);
                      const new_folder_hash = await hashForFolder(moduleFolder);
                      this.plugin.data.installedFolders[name].hash = new_folder_hash;
                      this.plugin.data.folderOptOuts.push(`${name}/${submodule.name}`);
                      await updater.register_update();
                      notice.setMessage(`Uninstalled "${name} > ${submodule.name}"`);
                      setTimeout(() => {
                        notice.hide();
                      }, 3000);
                      this.refreshDisplay();
                    });
                }
              });
            }
          });
        }
      });
    const addModuleEl = feedSection.createDiv({ cls: "module-settings" });
    new Setting(addModuleEl)
      .setName("Add module")
      .setDesc("Add a new module by URL.")
      .addText((text) => {
        text
          .setPlaceholder("https://example.com/manifest.vnm")
          .onChange((value) => {
            if (isUrl(value)) {
              this.custom_url_button.setText("+");
              this.custom_url_button.disabled = false;
              this.custom_url_input.removeClasses(['warn-color', 'error-color']);
            } else {
              this.custom_url_button.disabled = true;
              this.custom_url_input.addClass('warn-color');
              this.custom_url_input.removeClass('error-color');
            }
          });
        this.custom_url_input = text.inputEl;
      })
      .addButton((btn) => {
        btn
          .setButtonText('+')
          .onClick(async () => {
            this.custom_url_button.disabled = true;
            this.custom_url_button.setText("");
            this.custom_url_button.addClass("loading-spinner");
            const url = this.custom_url_input.value;
            try {
              const vnm_data: VNMMetadata = await fetch_vnm(url);
              if (this.plugin.data.canonicalVNMs[vnm_data.folder] || this.plugin.data.userVNMs[vnm_data.folder]) {
                this.custom_url_button.removeClass("loading-spinner");
                this.custom_url_button.setText("✅");
                displayTooltip(this.custom_url_input, "Module already added", {placement: "top"});
                return;
              }
              this.plugin.data.knownFolders[vnm_data.folder] = vnm_data;
              this.plugin.data.lastUpdatedTimes[vnm_data.folder + " VNM"] = Date.now();
              this.plugin.data.userVNMs[vnm_data.folder] = url;
              this.plugin.save();
              const modal = new NewModuleModal(
                this.plugin,
                new FolderUpdater(this.plugin, vnm_data.folder)
              );
              modal.onClose = () => {
                this.refreshDisplay();
              };
              modal.open();
            } catch (e) {
              console.error(e);
              this.custom_url_input.addClass('error-color');
              this.custom_url_input.removeClass('warn-color');
              this.custom_url_button.removeClass("loading-spinner");
              this.custom_url_button.setText("❌");
              displayTooltip(this.custom_url_input, "Invalid URL", {placement: "top"});
              return;
            }
          });
        this.custom_url_button = btn.buttonEl;
        this.custom_url_input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            this.custom_url_button.click();
          }
        });
      });
  }
}