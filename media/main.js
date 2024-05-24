(function () {
  const vscode = acquireVsCodeApi();

  let response = '';

  // Handle messages sent from the extension to the webview
  window.addEventListener("message", (event) => {
    const message = event.data;
    switch (message.type) {
      case "addResponse": {
        response = message.value;
        setResponse();
        break;
      }
      case 'showSpinner':
        showSpinner();
        break;
      case 'hideSpinner':
        hideSpinner();
        break;
      case 'updateHistory':
        document.getElementById('history').innerHTML = message.value;
        break;
      case "clearResponse": {
        response = '';
        break;
      }
      case "setPrompt": {
        // document.getElementById("prompt-input").value = message.value;
        setPrompt(message.value);
        document.getElementById("prompt-input").value = '';
        break;
      }
    }
  });

  function fixCodeBlocks(response) {
    // Use a regular expression to find all occurrences of the substring in the string
    const REGEX_CODEBLOCK = new RegExp('```', 'g');
    const matches = response.match(REGEX_CODEBLOCK);

    // Return the number of occurrences of the substring in the response, check if even
    const count = matches ? matches.length : 0;
    if (count % 2 === 0) {
      return response;
    } else {
      // else append ``` to the end to make the last code block complete
      return response.concat('\n```');
    }
  }

  function setPrompt(prompt) {
    const promptDiv = document.getElementById("prompt");
    const promptElement = document.createElement("div");
    promptElement.innerHTML = `<strong>${prompt}</strong>`;
    promptDiv.prepend(promptElement);
  }

  function adjustHeight(element) {
    element.style.height = 'auto';
    element.style.height = element.scrollHeight + 'px';
  }

  function showSpinner() {
    const responseDiv = document.getElementById("spinner");
    const spinnerElement = document.createElement("div");
    spinnerElement.className = 'spinner';
    spinnerElement.id = 'loading-spinner';
    responseDiv.prepend(spinnerElement);
  }

  function hideSpinner() {
    const spinnerElement = document.getElementById('loading-spinner');
    if (spinnerElement) {
      spinnerElement.remove();
    }
  }

  function setResponse() {
    var converter = new showdown.Converter({
      omitExtraWLInCodeBlocks: true,
      simplifiedAutoLink: true,
      excludeTrailingPunctuationFromURLs: true,
      literalMidWordUnderscores: true,
      simpleLineBreaks: true
    });
    response = fixCodeBlocks(response);
    html = converter.makeHtml(response);
    document.getElementById("response").innerHTML = html;

    var preCodeBlocks = document.querySelectorAll("pre code");
    for (var i = 0; i < preCodeBlocks.length; i++) {
      preCodeBlocks[i].classList.add(
        "p-2",
        "my-2",
        "block",
        "overflow-x-scroll"
      );
    }

    var codeBlocks = document.querySelectorAll('code');
    for (var i = 0; i < codeBlocks.length; i++) {
      // Check if innertext starts with "Copy code"
      if (codeBlocks[i].innerText.startsWith("Copy code")) {
        codeBlocks[i].innerText = codeBlocks[i].innerText.replace("Copy code", "");
      }

      codeBlocks[i].classList.add("inline-flex", "max-w-full", "overflow-hidden", "rounded-sm", "cursor-pointer");

      codeBlocks[i].addEventListener('click', function (e) {
        e.preventDefault();
        vscode.postMessage({
          type: 'codeSelected',
          value: this.innerText
        });
      });

      const d = document.createElement('div');
      d.innerHTML = codeBlocks[i].innerHTML;
      codeBlocks[i].innerHTML = null;
      codeBlocks[i].appendChild(d);
      d.classList.add("code");
    }

    microlight.reset('code');
  }

  // Listen for keyup events on the prompt input element
  document.getElementById('prompt-input').addEventListener('keyup', function (e) {
    // If the key that was pressed was the Enter key
    if (e.key === 'Enter') {
      sendMessage(this.value);
    }
  });

  // Listen for click events on the send button
  document.getElementById('send-button').addEventListener('click', function () {
    const input = document.getElementById('prompt-input');
    sendMessage(input.value);
  });

  function sendMessage(value) {
    if (value.trim()) {
      vscode.postMessage({
        type: 'prompt',
        value: value
      });
    }
  }
})();
