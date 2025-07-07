import { App, requestUrl, TFile, TFolder, Notice, TAbstractFile } from "obsidian";

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

export function* allFilesInFolder(folder: TFolder): Iterable<TFile> {
  for (const child of folder.children) {
    if (child instanceof TFile) {
      yield child;
    } else if (child instanceof TFolder) {
      yield* allFilesInFolder(child);
    }
  }
}
