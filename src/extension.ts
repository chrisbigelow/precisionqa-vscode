import * as vscode from 'vscode';
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { ChatMessageHistory } from "langchain/stores/message/in_memory";


export function activate(context: vscode.ExtensionContext) {
	// Get the API session token from the extension's configuration
	const config = vscode.workspace.getConfiguration('precision-qa');
	const apiToken = config.get('apiToken') as string|undefined;

	// Create a new ChatGPTViewProvider instance and register it with the extension's context
	const provider = new PrecisionQAViewProvider(context.extensionUri);
	provider.setTokens(apiToken);  
	// provider.setTokens(sessionToken, clearanceToken);

	// Put configuration settings into the provider
	provider.selectedInsideCodeblock = config.get('selectedInsideCodeblock') || false;
	provider.pasteOnClick = config.get('pasteOnClick') || false;
	provider.keepConversation = config.get('keepConversation') || false;
	provider.timeoutLength = config.get('timeoutLength') || 60;

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(PrecisionQAViewProvider.viewType, provider,  {
			webviewOptions: { retainContextWhenHidden: true }
		})
	);



	// Register the commands that can be called from the extension's package.json
	const commandHandler = (command:string) => {
		const config = vscode.workspace.getConfiguration('precision-qa');
		const prompt = config.get(command) as string;
		provider.search(prompt);
	};

	const commandAsk = vscode.commands.registerCommand('precision-qa.ask', () => {
		vscode.window.showInputBox({ prompt: 'What do you want to do?' }).then((value) => {
			provider.search(value);
		});
	});
	const commandConversationId = vscode.commands.registerCommand('precision-qa.conversationId', () => {
		vscode.window.showInputBox({ 
			prompt: 'Set Conversation ID or delete it to reset the conversation',
			placeHolder: 'conversationId (leave empty to reset)',
			value: provider.getConversationId()
		}).then((conversationId) => {
			if (!conversationId) {
				provider.setConversationId();
			} else {
				provider.setConversationId(conversationId);
			}
		});
	});
	const commandExplain = vscode.commands.registerCommand('precision-qa.explain', () => {	
		commandHandler('promptPrefix.explain');
	});
	const commandRefactor = vscode.commands.registerCommand('precision-qa.refactor', () => {
		commandHandler('promptPrefix.refactor');
	});
	const commandOptimize = vscode.commands.registerCommand('precision-qa.optimize', () => {
		commandHandler('promptPrefix.optimize');
	});
	const commandProblems = vscode.commands.registerCommand('precision-qa.findProblems', () => {
		commandHandler('promptPrefix.findProblems');
	});

	let commandResetConversation = vscode.commands.registerCommand('precision-qa.resetConversation', () => {
		provider.setConversationId();
	});
	

	context.subscriptions.push(commandAsk, commandConversationId, commandExplain, commandRefactor, commandOptimize, commandProblems, commandResetConversation);



	// Change the extension's session token when configuration is changed
	vscode.workspace.onDidChangeConfiguration((event: vscode.ConfigurationChangeEvent) => {
		if (event.affectsConfiguration('precision-qa.apiToken')) {
			// Get the extension's configuration
			const config = vscode.workspace.getConfiguration('preision-qa');
			const apiToken = config.get('apiToken') as string|undefined;
			// add the new token to the provider
			provider.setTokens(apiToken);

		} else if (event.affectsConfiguration('precision-qa.selectedInsideCodeblock')) {
			const config = vscode.workspace.getConfiguration('precision-qa');
			provider.selectedInsideCodeblock = config.get('selectedInsideCodeblock') || false;

		} else if (event.affectsConfiguration('precision-qa.pasteOnClick')) {
			const config = vscode.workspace.getConfiguration('precision-qa');
			provider.pasteOnClick = config.get('pasteOnClick') || false;

		} else if (event.affectsConfiguration('precision-qa.keepConversation')) {
			const config = vscode.workspace.getConfiguration('precision-qa');
			provider.keepConversation = config.get('keepConversation') || false;

		}else if (event.affectsConfiguration('precision-qa.timeoutLength')) {
			const config = vscode.workspace.getConfiguration('precision-qa');
			provider.timeoutLength = config.get('timeoutLength') || 60;
		}
});
}


class PrecisionQAViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'precision-qa.chatView';

	private _view?: vscode.WebviewView;

	// This variable holds a reference to the ChatOpenAI instance
	private _chatOpenAi?: ChatOpenAI;
	private _conversation?: ChatMessageHistory;

	private _response?: string;
	private _prompt?: string;
	private _fullPrompt?: string;
	private _conversationHistory: string = '';


	public selectedInsideCodeblock = false;
	public pasteOnClick = true;
	public keepConversation = true;
	public timeoutLength = 60;
	private _apiToken?: string;

	// In the constructor, we store the URI of the extension
	constructor(private readonly _extensionUri: vscode.Uri) {
		
	}
	
	// Set the session and clearance token and create a new API instance based on these tokens
	public setTokens(apiToken?: string) {
		this._apiToken = apiToken;
		this._newAPI();
	}

	public setConversationId(conversationId?: string) {
		if (!conversationId) {
			this._conversation = new ChatMessageHistory();
			this._conversationHistory = '';
		} else {
			// Change to load old conversation
			this._conversation = new ChatMessageHistory();
		}
	}

	public getConversationId() {
		// change this to return the conversation id associated with the ChatMessageHistory
		return "22";
	}

	// This private method initializes a new chat instance, using the api token if it is set
	private _newAPI() {
		if (!this._apiToken) {
		  console.warn("api token not set");
		} else {
		  this._chatOpenAi = new ChatOpenAI({
			apiKey: this._apiToken,
			model: "gpt-4o",
			temperature: 0.2,
		  });
		  this._conversation = new ChatMessageHistory();
		  // this._conversation = this._chatGPTAPI.getConversation();
		}
	  }

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		// set options for the webview
		webviewView.webview.options = {
			// Allow scripts in the webview
			enableScripts: true,
			localResourceRoots: [
				this._extensionUri
			]
		};

		// set the HTML for the webview
		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		// add an event listener for messages received by the webview
		webviewView.webview.onDidReceiveMessage(data => {
			switch (data.type) {
				case 'codeSelected':
					{
						// do nothing if the pasteOnClick option is disabled
						if (!this.pasteOnClick) {
							break;
						}

						let code = data.value;
						code = code.replace(/([^\\])(\$)([^{0-9])/g, "$1\\$$$3");

						// insert the code as a snippet into the active text editor
						vscode.window.activeTextEditor?.insertSnippet(new vscode.SnippetString(code));
						break;
					}
				case 'prompt':
					{
						this.search(data.value);
					}
			}
		});
	}



	public async search(prompt?:string) {
		this._prompt = prompt;
		if (!prompt) {
			prompt = '';
		};

		// Check if the chatOpenAi instance is defined
		if (!this._chatOpenAi) {
			this._newAPI();
		}

		// focus gpt activity from activity bar
		if (!this._view) {
			await vscode.commands.executeCommand('precision-qa.chatView.focus');
		} else {
			this._view?.show?.(true);
		}
		
		let response = '';

		// Get the selected text of the active editor
		const selection = vscode.window.activeTextEditor?.selection;
		const selectedText = vscode.window.activeTextEditor?.document.getText(selection);
		let searchPrompt = '';

		if (selection && selectedText) {
			// If there is a selection, add the prompt and the selected text to the search prompt
			if (this.selectedInsideCodeblock) {
				searchPrompt = `${prompt}\n\`\`\`\n${selectedText}\n\`\`\``;
			} else {
				searchPrompt = `${prompt}\n${selectedText}\n`;
			}
		} else {
			// Otherwise, just use the prompt if user typed it
			searchPrompt = prompt;
		}

		this._fullPrompt = searchPrompt;


		if (!this._conversation) {
			response = '[ERROR] Conversation not initialized';
		}
		else if (!this._chatOpenAi) {
			console.log("TESTING")
			response = '[ERROR] Enter an API key in the extension settings';
		} else {
			// If successfully signed in
			console.log("sendMessage");
			
			// Make sure the prompt is shown
			this._view?.webview.postMessage({ type: 'setPrompt', value: this._prompt });

			if (this._view) {
				//this._view.webview.postMessage({ type: 'addResponse', value: '...' });
				this._view.webview.postMessage({ type: 'showSpinner' });
			}

			let agent;
			if (this.keepConversation) {
				// agent = this._conversation;
				agent = this._chatOpenAi;
			} else {
				agent = this._chatOpenAi;
			}

			try {
				// Send the search prompt to the _chatOpenAi instance and store the response
				let humanMessage = new HumanMessage(searchPrompt);
				this._conversation.addMessage(humanMessage);
				let aiMessage = await agent.invoke([humanMessage,]);
				this._conversation.addMessage(aiMessage);
				response = aiMessage.content.toString();
			} catch (e) {
				console.error(e);
				response = `[ERROR] ${e}`;
			} finally {
				this._view?.webview.postMessage({ type: 'hideSpinner' });
				this._view?.webview.postMessage({ type: 'addResponse', value: response });
				// const messages = await this._conversation?.getMessages();
				this._conversationHistory += `<div class="py-10"><b>Prompt:</b> ${this._prompt}<br/><b>Response:</b> ${response}</div><hr/>`;

			}
		}

		// Saves the response
		this._response = response;

		// Show the view and send a message to the webview with the response
		if (this._view) {
			this._view.show?.(true);
			this._view.webview.postMessage({ type: 'addResponse', value: response });
			this._view.webview.postMessage({ type: 'updateHistory', value: this._conversationHistory });
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
		const microlightUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'scripts', 'microlight.min.js'));
		const tailwindUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'scripts', 'showdown.min.js'));
		const showdownUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'scripts', 'tailwind.min.js'));
	
		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<script src="${tailwindUri}"></script>
				<script src="${showdownUri}"></script>
				<script src="${microlightUri}"></script>
				<style>
				.code {
					white-space : pre;
				}
				.prompt-input {
					margin-top: 10px;
					margin-bottom: 10px;
				}
				.spinner {
					margin: 16px auto;
					width: 40px;
					height: 40px;
					border: 4px solid rgba(0, 0, 0, 0.1);
					border-top: 4px solid #cfe500;
					border-radius: 50%;
					animation: spin 1s linear infinite;
				}
				@keyframes spin {
					0% { transform: rotate(0deg); }
					100% { transform: rotate(360deg); }
				}
				#prompt, #response {
					transition: all 0.3s ease;
				}
				#history {
					margin-top: 10px;
					margin-bottom: 10px;
				}
				#send-button {
					background-color: #cfe500;
					color: black;
				}
				</style>
			</head>
			<body>
			    <div id="history" class="text-sm"></div>
				<div id="spinner"></div>
				<div class="flex items-center spaced">
					<input class="h-10 w-full text-white bg-stone-700 p-4 text-sm prompt-input" type="text" id="prompt-input" placeholder="Type your prompt"/>
					<button id="send-button" class="h-10 px-4 text-white text-sm">Send</button>
				</div>
				<script src="${scriptUri}"></script>
			</body>
			</html>`;
	}
	
}

// This method is called when your extension is deactivated
export function deactivate() {}