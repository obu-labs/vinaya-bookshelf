import { App, requestUrl, TFile, TFolder, Notice, TAbstractFile } from "obsidian";
import * as JSZip from 'jszip';
import { hashForFileList, sha256 } from "./hashutils";

/**
 * Replaces `targetFolder` with the contents of the zip at `url`
 * 
 * @returns an SHA256 hash of the inflated directory's contents
 */
export async function downloadZip(url: string, targetFolder: string, app: App, notice?: Notice | null): Promise<string> {
  if (!notice) {
    notice = new Notice(`Downloading new ${targetFolder} folder...`, 0);
  } else {
    notice.setMessage(`Downloading new ${targetFolder} folder...`);
  }
  const response = await requestUrl(url);
  notice.hide();
  notice = new Notice(`Unpacking "${targetFolder}.zip"...`, 0);
  const zip = await JSZip.loadAsync(response.arrayBuffer);
  notice.hide()
  notice = new Notice(`Installing new "${targetFolder}" folder...`, 0);
  const folder = app.vault.getFolderByPath(targetFolder);
  const fileHashes: Map<string, string> = new Map<string, string>();
  const foldersTouched: Set<string> = new Set<string>();
  const totalCount = Object.keys(zip.files).length;
  let fileCount = 0;
  for (const [path, file] of Object.entries(zip.files)) {
    const fullPath = `${targetFolder}/${path}`;

    if (file.dir) {
      if (foldersTouched.has(fullPath)) {
        continue;
      }
      foldersTouched.add(fullPath);
      await app.vault.createFolder(fullPath).catch(() => {
        /* Folder might already exist */
      });
    } else {
      const content = await file.async('uint8array');

      // Ensure parent folders exist
      const folderPath = fullPath.split('/').slice(0, -1).join('/');
      if (folderPath) {
        if (!foldersTouched.has(folderPath)) {
          await app.vault.createFolder(folderPath).catch(() => {
            /* Folder might already exist */
          });
          foldersTouched.add(folderPath);
        }
      }

      fileCount += 1;
      notice.setMessage(`Installing ${targetFolder} file ${fileCount}/${totalCount}...`);
      await app.vault.adapter.writeBinary(fullPath, content).catch(
        (err: Error) => {
          console.error(`Failed to create file ${fullPath}:`, err);
        }
      );
      const hash = await sha256(content);
      fileHashes.set(path, hash);
    }
  }

  notice.hide();
  if (folder) { // If !folder, it was created by the zip, so no pruning needed
    notice = new Notice(`Removing old files from "${targetFolder}"...`, 0);
    await pruneFolder(app, folder, fileHashes.keys(), notice);
  }

  notice = new Notice(`Saving "${targetFolder}" module...`, 0);
  const ret = await hashForFileList(fileHashes);
  notice.hide();
  return ret;
}

/**
 * Remove all files in `folder` except for those in `filesToKeep`.
 * 
 * @param filesToKeep files within `folder` (either relative or absolute paths)
 */
export async function pruneFolder(app: App, folder: TFolder, filesToKeep: Iterable<string>, notice?: Notice): Promise<void> {
  const keepFiles = new Set<string>();
  for (const file of filesToKeep) {
    if (file.startsWith(folder.path + "/")) {
      keepFiles.add(file);
    } else {
      keepFiles.add(folder.path + "/" + file);
    }
  }

  function recursivePruneHelper(
    node: TAbstractFile,
  ): {
    keep_any: boolean,
    files_to_delete: TFile[],
    folders_to_delete: TFolder[],
  } {
    if (node instanceof TFile) {
      const keep_any = keepFiles.has(node.path);
      const files_to_delete: TFile[] = [];
      if (!keep_any) {
        files_to_delete.push(node);
      }
      return { keep_any, files_to_delete, folders_to_delete: [] };
    }

    if (!(node instanceof TFolder)) {
      throw new Error(`Unknown file type: ${node}`);
    }

    let keptChildren = false;
    const files_to_delete: TFile[] = [];
    const folders_to_delete: TFolder[] = [];
    for (const child of [...(node as TFolder).children]) {
      const { 
        keep_any,
        files_to_delete: child_files_to_delete,
        folders_to_delete: child_folders_to_delete,
      } = recursivePruneHelper(child);
      keptChildren = keptChildren || keep_any;
      files_to_delete.push(...child_files_to_delete);
      folders_to_delete.push(...child_folders_to_delete);
    }

    if (keptChildren) {
      return { keep_any: true, files_to_delete, folders_to_delete };
    } else {
      return { keep_any: false, files_to_delete: [], folders_to_delete: [node] };
    }
  }

  const { keep_any, files_to_delete, folders_to_delete } = recursivePruneHelper(folder);
  if (!keep_any) {
    throw new Error("I expected to need to keep at least something!");
  }
  const promises: Promise<void>[] = [];
  for (const file of files_to_delete) {
    promises.push(app.vault.delete(file));
  }
  for (const folder of folders_to_delete) {
    promises.push(app.vault.delete(folder, true));
  }
  notice?.hide();
  if (promises.length === 0) {
    return;
  }
  notice = new Notice(`Deleting ${files_to_delete.length} file(s) and ${folders_to_delete.length} folder(s) from "${folder.name}"...`, 0);
  await Promise.all(promises);
  notice.hide();
}
