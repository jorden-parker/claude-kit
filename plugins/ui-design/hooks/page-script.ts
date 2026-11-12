export const PAGE_SCRIPT = String.raw`
(function(){
  function listAll(selector){ return Array.prototype.slice.call(document.querySelectorAll(selector)); }
  function readThemeRoot(isDark){ return 'data-theme="' + (isDark ? "dark" : "light") + '"'; }

  var tabs = listAll("[role=tab]");
  function selectTab(chosenTab){
    var shownPanelIds = chosenTab.getAttribute("aria-controls").split(" ");
    tabs.forEach(function(tab){
      var isChosen = tab === chosenTab;
      tab.setAttribute("aria-selected", String(isChosen));
      tab.tabIndex = isChosen ? 0 : -1;
    });
    listAll("[role=tabpanel]").forEach(function(panel){
      panel.hidden = shownPanelIds.indexOf(panel.id) < 0;
    });
  }
  tabs.forEach(function(tab, tabIndex){
    tab.addEventListener("click", function(){ selectTab(tab); });
    tab.addEventListener("keydown", function(event){
      var targetIndexByKey = { ArrowRight: tabIndex + 1, ArrowLeft: tabIndex - 1, Home: 0, End: tabs.length - 1 };
      if (!Object.prototype.hasOwnProperty.call(targetIndexByKey, event.key)) return;
      event.preventDefault();
      var targetTab = tabs[(targetIndexByKey[event.key] + tabs.length) % tabs.length];
      selectTab(targetTab);
      targetTab.focus();
    });
  });

  var widthButtons = listAll("[data-width]");
  widthButtons.forEach(function(widthButton){
    widthButton.addEventListener("click", function(){
      document.body.dataset.frameWidth = widthButton.dataset.width;
      widthButtons.forEach(function(otherButton){
        otherButton.setAttribute("aria-pressed", String(otherButton === widthButton));
      });
    });
  });

  var darkToggle = document.getElementById("toggle-dark");
  if (darkToggle) darkToggle.addEventListener("click", function(){
    var isDark = darkToggle.getAttribute("aria-pressed") !== "true";
    darkToggle.setAttribute("aria-pressed", String(isDark));
    listAll("iframe").forEach(function(frame){
      frame.srcdoc = frame.srcdoc.replace(readThemeRoot(!isDark), readThemeRoot(isDark));
    });
  });

  listAll("[data-copies]").forEach(function(copyButton){
    var command = document.getElementById(copyButton.dataset.copies);
    var status = document.getElementById("copy-status");
    function showCopied(){
      status.textContent = "Copied " + command.textContent + ". Paste it in the session.";
    }
    function selectCommand(){
      var range = document.createRange();
      range.selectNodeContents(command);
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      status.textContent = "Could not copy. The command is selected: press Cmd/Ctrl+C.";
    }
    copyButton.addEventListener("click", function(){
      try { navigator.clipboard.writeText(command.textContent).then(showCopied, selectCommand); } catch (error) { selectCommand(); }
    });
  });
})();
`;
