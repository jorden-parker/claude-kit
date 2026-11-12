export const STAGE_HEIGHT = { min: 240, max: 1600, initial: 640, step: 40 };

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

  var STAGE_HEIGHT = ${JSON.stringify(STAGE_HEIGHT)};
  var resizers = listAll("[data-resizer]");
  function readStageHeight(resizer){ return Number(resizer.getAttribute("aria-valuenow")); }
  function setStageHeight(requestedHeight){
    var height = Math.round(Math.min(STAGE_HEIGHT.max, Math.max(STAGE_HEIGHT.min, requestedHeight)));
    var edge = height === STAGE_HEIGHT.min ? "min" : height === STAGE_HEIGHT.max ? "max" : "";
    document.body.style.setProperty("--stage-height", height + "px");
    resizers.forEach(function(resizer){
      resizer.setAttribute("aria-valuenow", String(height));
      resizer.dataset.edge = edge;
    });
  }
  resizers.forEach(function(resizer){
    var dragStart = null;
    function stopDragging(){
      dragStart = null;
      delete document.body.dataset.resizing;
    }
    resizer.addEventListener("pointerdown", function(event){
      event.preventDefault();
      dragStart = { pointerY: event.clientY, height: readStageHeight(resizer) };
      if (resizer.setPointerCapture) resizer.setPointerCapture(event.pointerId);
      document.body.dataset.resizing = "true";
    });
    resizer.addEventListener("pointermove", function(event){
      if (dragStart) setStageHeight(dragStart.height + event.clientY - dragStart.pointerY);
    });
    resizer.addEventListener("pointerup", stopDragging);
    resizer.addEventListener("pointercancel", stopDragging);
    resizer.addEventListener("dblclick", function(){ setStageHeight(STAGE_HEIGHT.initial); });
    resizer.addEventListener("keydown", function(event){
      var height = readStageHeight(resizer);
      var targetHeightByKey = { ArrowDown: height + STAGE_HEIGHT.step, ArrowUp: height - STAGE_HEIGHT.step, Home: STAGE_HEIGHT.min, End: STAGE_HEIGHT.max };
      if (!Object.prototype.hasOwnProperty.call(targetHeightByKey, event.key)) return;
      event.preventDefault();
      setStageHeight(targetHeightByKey[event.key]);
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
