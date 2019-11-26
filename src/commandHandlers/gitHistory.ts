import { inject, injectable } from 'inversify';
import * as md5 from 'md5';
import * as osLocale from 'os-locale';
import * as path from 'path';
import { Uri, ViewColumn, window } from 'vscode';
import { ICommandManager } from '../application/types';
import { IDisposableRegistry } from '../application/types/disposableRegistry';
import { FileCommitDetails } from '../common/types';
import { previewUri } from '../constants';
import { IServiceContainer } from '../ioc/types';
import { FileNode } from '../nodes/types';
import { IServerHost, IWorkspaceQueryStateStore } from '../server/types';
import { BranchSelection, IGitServiceFactory } from '../types';
import { command } from './registration';
import { IGitHistoryCommandHandler } from './types';

@injectable()
export class GitHistoryCommandHandler implements IGitHistoryCommandHandler {
    private _server?: IServerHost;
    private get server(): IServerHost {
        if (!this._server) {
            this._server = this.serviceContainer.get<IServerHost>(IServerHost);
            this.disposableRegistry.register(this._server);
        }
        return this._server;
    }
    constructor(@inject(IServiceContainer) private serviceContainer: IServiceContainer,
        @inject(IDisposableRegistry) private disposableRegistry: IDisposableRegistry,
        @inject(ICommandManager) private commandManager: ICommandManager) { }

    @command('git.viewFileHistory', IGitHistoryCommandHandler)
    public async viewFileHistory(info?: FileCommitDetails | Uri): Promise<void> {
        let fileUri: Uri | undefined;
        if (info) {
            if (info instanceof FileCommitDetails) {
                const committedFile = info.committedFile;
                fileUri = committedFile.uri ? Uri.file(committedFile.uri.fsPath) : Uri.file(committedFile.oldUri!.fsPath);
            } else if (info instanceof FileNode) {
                const committedFile = info.data!.committedFile;
                fileUri = committedFile.uri ? Uri.file(committedFile.uri.fsPath) : Uri.file(committedFile.oldUri!.fsPath);
            } else if (info instanceof Uri) {
                fileUri = info;
                // tslint:disable-next-line:no-any
            } else if ((info as any).resourceUri) {
                // tslint:disable-next-line:no-any
                fileUri = (info as any).resourceUri as Uri;
            }
        } else {
            const activeTextEditor = window.activeTextEditor!;
            if (!activeTextEditor || activeTextEditor.document.isUntitled) {
                return;
            }
            fileUri = activeTextEditor.document.uri;
        }
        return this.viewHistory(fileUri);
    }
    @command('git.viewLineHistory', IGitHistoryCommandHandler)
    public async viewLineHistory(): Promise<void> {
        let fileUri: Uri | undefined;
        const activeTextEditor = window.activeTextEditor!;
        if (!activeTextEditor || activeTextEditor.document.isUntitled) {
            return;
        }
        fileUri = activeTextEditor.document.uri;
        const currentLineNumber = activeTextEditor.selection.start.line + 1;
        return this.viewHistory(fileUri, currentLineNumber);
    }
    @command('git.viewHistory', IGitHistoryCommandHandler)
    public async viewBranchHistory(): Promise<void> {
        return this.viewHistory();
    }

    public async viewHistory(fileUri?: Uri, lineNumber?: number): Promise<void> {
        const gitService = await this.serviceContainer.get<IGitServiceFactory>(IGitServiceFactory)
                                                      .createGitService(fileUri);
        const branchName = await gitService.getCurrentBranch();
        const gitRoot = await gitService.getGitRoot();
        const startupInfo = await this.server.start();
        const locale = await osLocale();
        const gitRootsUnderWorkspace = await gitService.getGitRoots();
        // Do not include the search string into this
        const fullId = `${startupInfo.port}:${BranchSelection.Current}:${fileUri ? fileUri.fsPath : ''}:${gitRoot}`;
        const id = md5(fullId); //Date.now().toString();
        await this.serviceContainer.get<IWorkspaceQueryStateStore>(IWorkspaceQueryStateStore)
                                   .initialize(id, '', gitRoot, branchName, BranchSelection.Current, '', fileUri, lineNumber);
        const queryArgs = [
            `id=${id}`,
            `port=${startupInfo.port}`,
            `internalPort=${startupInfo.port - 1}`,
            `file=${fileUri ? encodeURIComponent(fileUri.fsPath) : ''}`,
            `branchSelection=${BranchSelection.Current}`, `locale=${encodeURIComponent(locale)}`
        ];
        queryArgs.push(`branchName=${encodeURIComponent(branchName)}`);
        const uri = `${previewUri}?${queryArgs.join('&')}`;

        const repoName = gitRootsUnderWorkspace.length > 1 ? ` (${path.basename(gitRoot)})` : '';
        let title = fileUri ? `File History (${path.basename(fileUri.fsPath)})` : `Git History ${repoName}`;
        if (fileUri && typeof lineNumber === 'number') {
            title = `Line History (${path.basename(fileUri.fsPath)}#${lineNumber})`;
        }

        this.commandManager.executeCommand('previewHtml', uri, ViewColumn.One, title);
    }
}
