export const PAGE_SCRIPT = String.raw`
(function(){
  var draft = JSON.parse(document.getElementById("draft-data").textContent);
  var storageKey = "draft-pr:" + draft.draftId;
  var viewStorageKey = "draft-pr:view";
  var hasBridge = location.protocol === "http:" || location.protocol === "https:";
  var PING_INTERVAL_MILLISECONDS = 30000;
  var TICK = String.fromCharCode(96);
  var CODE_FENCE = TICK + TICK + TICK;
  var TILDE_FENCE = "~~~";
  var PLACEHOLDER_MARK = String.fromCharCode(0);
  var EVENT_NAMES = { COMMENT: "Comment", APPROVE: "Approve", REQUEST_CHANGES: "Request changes", PENDING: "Pending" };

  function findById(elementId){ return document.getElementById(elementId); }
  function listAll(selector, searchRoot){ return Array.prototype.slice.call((searchRoot || document).querySelectorAll(selector)); }

  function escapeHtml(text){
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function isSafeUrl(url){ return /^(https?:\/\/|mailto:)/i.test(url); }
  function buildLinkHtml(url, labelHtml){
    return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + labelHtml + "</a>";
  }
  function renderInline(text){
    var codeSpans = [];
    var codeSpanPattern = new RegExp(TICK + "([^" + TICK + "]+)" + TICK, "g");
    var placeholderPattern = new RegExp(PLACEHOLDER_MARK + "(\\d+)" + PLACEHOLDER_MARK, "g");
    var html = escapeHtml(text).replace(codeSpanPattern, function(match, code){
      codeSpans.push(code);
      return PLACEHOLDER_MARK + (codeSpans.length - 1) + PLACEHOLDER_MARK;
    });
    html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function(match, label, url){
      return isSafeUrl(url) ? buildLinkHtml(url, label) : match;
    });
    html = html.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, function(match, leadingText, url){
      return leadingText + buildLinkHtml(url, url);
    });
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/(^|[^\w])__([^_]+)__(?!\w)/g, "$1<strong>$2</strong>");
    html = html.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
    html = html.replace(/(^|[^\w])_([^_\s][^_]*)_(?!\w)/g, "$1<em>$2</em>");
    html = html.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    return html.replace(placeholderPattern, function(match, spanIndex){
      return "<code>" + codeSpans[Number(spanIndex)] + "</code>";
    });
  }
  function isFenceLine(line){
    var trimmedLine = line.trim();
    return trimmedLine.indexOf(CODE_FENCE) === 0 || trimmedLine.indexOf(TILDE_FENCE) === 0;
  }
  function splitTableRow(line){
    return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(function(cell){ return cell.trim(); });
  }
  function stripComments(source){
    return source.split(PLACEHOLDER_MARK).join("").replace(/<!--[\s\S]*?-->/g, "");
  }
  function renderBlocks(lines){
    var html = [];
    var paragraphLines = [];
    var openListTag = "";
    var lineIndex = 0;
    function flushParagraph(){
      if (!paragraphLines.length) return;
      html.push("<p>" + renderInline(paragraphLines.join("\n")).replace(/\n/g, "<br>") + "</p>");
      paragraphLines = [];
    }
    function closeList(){
      if (!openListTag) return;
      html.push("</" + openListTag + ">");
      openListTag = "";
    }
    function closeOpenBlocks(){ flushParagraph(); closeList(); }
    while (lineIndex < lines.length) {
      var line = lines[lineIndex];
      if (isFenceLine(line)) {
        closeOpenBlocks();
        var codeLines = [];
        lineIndex++;
        while (lineIndex < lines.length && !isFenceLine(lines[lineIndex])) { codeLines.push(lines[lineIndex]); lineIndex++; }
        lineIndex++;
        html.push("<pre><code>" + escapeHtml(codeLines.join("\n")) + "</code></pre>");
        continue;
      }
      var headingMatch = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (headingMatch) {
        closeOpenBlocks();
        var headingLevel = headingMatch[1].length;
        html.push("<h" + headingLevel + ">" + renderInline(headingMatch[2]) + "</h" + headingLevel + ">");
        lineIndex++;
        continue;
      }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
        closeOpenBlocks();
        html.push("<hr>");
        lineIndex++;
        continue;
      }
      if (/^\s*>/.test(line)) {
        closeOpenBlocks();
        var quotedLines = [];
        while (lineIndex < lines.length && /^\s*>/.test(lines[lineIndex])) {
          quotedLines.push(lines[lineIndex].replace(/^\s*>\s?/, ""));
          lineIndex++;
        }
        html.push("<blockquote>" + renderBlocks(quotedLines) + "</blockquote>");
        continue;
      }
      var listMatch = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
      if (listMatch) {
        flushParagraph();
        var listTag = /\d/.test(listMatch[2]) ? "ol" : "ul";
        if (openListTag !== listTag) { closeList(); html.push("<" + listTag + ">"); openListTag = listTag; }
        var indentClass = "indent-" + Math.min(3, Math.floor(listMatch[1].replace(/\t/g, "  ").length / 2));
        var taskMatch = /^\[([ xX])\]\s+(.*)$/.exec(listMatch[3]);
        if (taskMatch) {
          var checkedAttribute = taskMatch[1] === " " ? "" : " checked";
          html.push('<li class="task ' + indentClass + '"><input type="checkbox" disabled' + checkedAttribute + "><span>" + renderInline(taskMatch[2]) + "</span></li>");
        } else {
          html.push('<li class="' + indentClass + '">' + renderInline(listMatch[3]) + "</li>");
        }
        lineIndex++;
        continue;
      }
      var nextLine = lines[lineIndex + 1] || "";
      if (line.indexOf("|") !== -1 && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(nextLine)) {
        closeOpenBlocks();
        var headerCells = splitTableRow(line).map(function(cell){ return "<th>" + renderInline(cell) + "</th>"; }).join("");
        var bodyRows = [];
        lineIndex += 2;
        while (lineIndex < lines.length && lines[lineIndex].indexOf("|") !== -1) {
          bodyRows.push("<tr>" + splitTableRow(lines[lineIndex]).map(function(cell){ return "<td>" + renderInline(cell) + "</td>"; }).join("") + "</tr>");
          lineIndex++;
        }
        html.push("<table><thead><tr>" + headerCells + "</tr></thead><tbody>" + bodyRows.join("") + "</tbody></table>");
        continue;
      }
      if (!line.trim()) { closeOpenBlocks(); lineIndex++; continue; }
      closeList();
      paragraphLines.push(line.trim());
      lineIndex++;
    }
    closeOpenBlocks();
    return html.join("");
  }
  function renderMarkdown(source){
    var html = renderBlocks(stripComments(source).split("\n"));
    return html || '<p class="empty">Nothing to preview.</p>';
  }

  function loadSavedState(){
    try { return JSON.parse(localStorage.getItem(storageKey) || "null"); } catch (error) { return null; }
  }
  function saveState(state){
    try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch (error) {}
  }
  function forgetSavedState(){
    try { localStorage.removeItem(storageKey); } catch (error) {}
  }
  function readSavedView(){
    try { return localStorage.getItem(viewStorageKey); } catch (error) { return null; }
  }
  function saveView(view){
    try { localStorage.setItem(viewStorageKey, view); } catch (error) {}
  }

  var toast = findById("toast");
  var toastTimer = null;
  function showToast(message){
    toast.textContent = message;
    toast.classList.add("is-shown");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ toast.classList.remove("is-shown"); }, 1800);
  }
  function copyText(text, button){
    var restingLabel = button.dataset.restingLabel || button.textContent;
    button.dataset.restingLabel = restingLabel;
    function showCopied(){
      button.textContent = "Copied";
      showToast("Copied to the clipboard");
      setTimeout(function(){ button.textContent = restingLabel; }, 1500);
    }
    function copyThroughSelection(){
      var scratchField = document.createElement("textarea");
      scratchField.value = text;
      scratchField.setAttribute("readonly", "");
      scratchField.style.position = "fixed";
      scratchField.style.opacity = "0";
      document.body.appendChild(scratchField);
      scratchField.select();
      var isCopied = false;
      try { isCopied = document.execCommand("copy"); } catch (error) {}
      document.body.removeChild(scratchField);
      if (isCopied) showCopied(); else showToast("Could not copy. Select the text and press Cmd/Ctrl+C.");
    }
    try { navigator.clipboard.writeText(text).then(showCopied, copyThroughSelection); } catch (error) { copyThroughSelection(); }
  }
  function growToContent(textarea){
    textarea.style.height = "auto";
    textarea.style.height = (textarea.scrollHeight + 2) + "px";
  }

  var notice = findById("notice");
  function showNotice(tone, message, detail, linkUrl, linkLabel){
    var noticeBody = notice.querySelector(".notice-body");
    notice.className = "notice" + (tone === "error" ? " is-error" : tone === "success" ? " is-success" : "");
    notice.querySelector(".dot").className = "dot " + (tone === "error" ? "tone-red" : tone === "success" ? "tone-green" : "tone-amber");
    noticeBody.textContent = "";
    var messageLine = document.createElement("p");
    messageLine.textContent = message + " ";
    if (linkUrl && /^https?:\/\//.test(linkUrl)) {
      var link = document.createElement("a");
      link.href = linkUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = linkLabel;
      messageLine.appendChild(link);
    }
    noticeBody.appendChild(messageLine);
    if (detail) {
      var detailBlock = document.createElement("pre");
      detailBlock.textContent = detail;
      noticeBody.appendChild(detailBlock);
    }
  }
  function hideNotice(){ notice.className = "notice is-hidden"; }

  var saveStatePill = findById("save-state");
  var resetButton = findById("reset-draft");
  function showEditedState(isEdited){
    saveStatePill.lastChild.textContent = isEdited ? "Edited · saved in this browser" : "Original draft";
    saveStatePill.querySelector(".dot").className = "dot " + (isEdited ? "tone-blue" : "tone-gray");
    resetButton.classList.toggle("is-hidden", !isEdited);
  }

  var postButton = findById("post-draft");
  var confirmSection = findById("confirm-post");
  var confirmText = findById("confirm-text");
  var confirmButton = findById("confirm-post-button");
  var isPosting = false;
  var isConnected = hasBridge;
  var page = null;

  function refreshPostButton(){
    postButton.textContent = isPosting ? "Posting…" : page.describePostButton();
    postButton.disabled = isPosting || !isConnected || page.isPostLocked();
  }
  function closeConfirm(){ confirmSection.classList.add("is-hidden"); }
  function openConfirm(){
    if (postButton.disabled) return;
    var problem = page.findProblem();
    if (problem) { showNotice("error", problem); return; }
    hideNotice();
    confirmText.textContent = page.describeConfirmation();
    confirmButton.textContent = page.describeConfirmButton();
    confirmSection.classList.remove("is-hidden");
    confirmButton.focus();
  }
  function showDisconnected(){
    isConnected = false;
    closeConfirm();
    showNotice("warning", "This page lost its link to the local helper that posts. Run the command again to post. The copy buttons still work.");
    refreshPostButton();
  }
  function sendPost(){
    closeConfirm();
    isPosting = true;
    refreshPostButton();
    fetch("post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(page.buildPayload())
    }).then(function(response){ return response.json(); }).then(function(answer){
      isPosting = false;
      if (answer.isPosted) page.showPosted(answer);
      else showNotice("error", "GitHub did not take it.", answer.problem || "No reason was given.");
      refreshPostButton();
    }, function(){
      isPosting = false;
      showDisconnected();
    });
  }
  function pingBridge(){
    fetch("ping", { method: "POST" }).then(function(response){
      if (!response.ok) { showDisconnected(); return; }
      if (!isConnected) { isConnected = true; hideNotice(); refreshPostButton(); }
    }, function(){ if (isConnected) showDisconnected(); });
  }
  function startPosting(describedPage){
    page = describedPage;
    postButton.addEventListener("click", openConfirm);
    confirmButton.addEventListener("click", sendPost);
    findById("cancel-post").addEventListener("click", closeConfirm);
    document.addEventListener("keydown", function(event){
      if (event.key === "Escape") closeConfirm();
      if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      if (confirmSection.classList.contains("is-hidden")) openConfirm(); else sendPost();
    });
    if (hasBridge) setInterval(pingBridge, PING_INTERVAL_MILLISECONDS);
    else showNotice("warning", "Posting is off: the local helper that posts for this page could not start (it needs Node.js). Editing, preview and the copy buttons work.");
    refreshPostButton();
  }

  function normalizeHeading(heading){
    return heading.replace(/\s*#*\s*$/, "").replace(/\s+/g, " ").trim().toLowerCase();
  }
  function readSectionStates(body, headings){
    var bodyLines = stripComments(body).split("\n");
    var isInsideFence = false;
    var foundHeadings = [];
    bodyLines.forEach(function(line, lineIndex){
      if (isFenceLine(line)) { isInsideFence = !isInsideFence; return; }
      var headingMatch = isInsideFence ? null : /^(#{1,6})\s+(.*)$/.exec(line);
      if (headingMatch) foundHeadings.push({ key: normalizeHeading(headingMatch[1] + " " + headingMatch[2]), level: headingMatch[1].length, lineIndex: lineIndex });
    });
    return headings.map(function(heading){
      var foundIndex = -1;
      foundHeadings.forEach(function(foundHeading, headingIndex){
        if (foundIndex === -1 && foundHeading.key === normalizeHeading(heading)) foundIndex = headingIndex;
      });
      if (foundIndex === -1) return "missing";
      var foundHeading = foundHeadings[foundIndex];
      var sectionEnd = bodyLines.length;
      foundHeadings.slice(foundIndex + 1).forEach(function(laterHeading){
        if (sectionEnd === bodyLines.length && laterHeading.level <= foundHeading.level) sectionEnd = laterHeading.lineIndex;
      });
      var sectionText = bodyLines.slice(foundHeading.lineIndex + 1, sectionEnd).join("").trim();
      return sectionText ? "filled" : "empty";
    });
  }

  function setUpPullRequestPage(){
    var titleInput = findById("pr-title");
    var bodyInput = findById("pr-body");
    var preview = findById("pr-preview");
    var editor = findById("body-editor");
    var draftCheckbox = findById("pr-is-draft");
    var sectionRows = listAll("#template-sections li");
    var sectionHeadings = sectionRows.map(function(row){ return row.dataset.heading; });
    var SECTION_STATES = { filled: ["tone-green", "Filled"], empty: ["tone-amber", "Empty"], missing: ["tone-red", "Missing"] };
    var existingNumber = draft.existingNumber;
    var originalState = { title: draft.title, body: draft.body, isDraft: draft.isDraft };
    var activeView = "write";

    function readState(){
      return { title: titleInput.value, body: bodyInput.value, isDraft: draftCheckbox ? draftCheckbox.checked : draft.isDraft };
    }
    function applyState(state){
      titleInput.value = state.title;
      bodyInput.value = state.body;
      if (draftCheckbox) draftCheckbox.checked = Boolean(state.isDraft);
    }
    function refreshSections(){
      var sectionStates = readSectionStates(bodyInput.value, sectionHeadings);
      var filledCount = 0;
      sectionRows.forEach(function(row, rowIndex){
        var stateDisplay = SECTION_STATES[sectionStates[rowIndex]];
        if (sectionStates[rowIndex] === "filled") filledCount++;
        row.querySelector(".dot").className = "dot " + stateDisplay[0];
        row.querySelector(".state").textContent = stateDisplay[1];
      });
      findById("template-score").textContent = filledCount + " of " + sectionRows.length + " filled";
    }
    function refresh(){
      var state = readState();
      var isEdited = JSON.stringify(state) !== JSON.stringify(originalState);
      preview.innerHTML = renderMarkdown(state.body);
      findById("title-count").textContent = state.title.length + " characters";
      findById("body-count").textContent = (state.body.trim() ? state.body.trim().split(/\s+/).length : 0) + " words";
      refreshSections();
      showEditedState(isEdited);
      if (isEdited) saveState(state); else forgetSavedState();
      if (activeView === "write") growToContent(bodyInput); else bodyInput.style.height = "";
    }
    function setView(view){
      activeView = view;
      editor.className = "editor is-" + view;
      listAll("[data-view]").forEach(function(tab){
        tab.classList.toggle("is-active", tab.dataset.view === view);
        tab.setAttribute("aria-selected", String(tab.dataset.view === view));
      });
      saveView(view);
      refresh();
    }

    var savedState = loadSavedState();
    if (savedState && typeof savedState.title === "string" && typeof savedState.body === "string") applyState(savedState);
    [titleInput, bodyInput].forEach(function(field){ field.addEventListener("input", refresh); });
    if (draftCheckbox) draftCheckbox.addEventListener("change", refresh);
    listAll("[data-view]").forEach(function(tab){
      tab.addEventListener("click", function(){ setView(tab.dataset.view); });
    });
    resetButton.addEventListener("click", function(){ applyState(originalState); refresh(); showToast("Back to the original draft"); });
    findById("copy-title").addEventListener("click", function(event){ copyText(titleInput.value, event.currentTarget); });
    findById("copy-body").addEventListener("click", function(event){ copyText(bodyInput.value, event.currentTarget); });

    var savedView = readSavedView();
    var hasSavedView = savedView === "write" || savedView === "preview" || savedView === "split";
    setView(hasSavedView ? savedView : window.innerWidth >= 1100 ? "split" : "write");

    startPosting({
      isPostLocked: function(){ return false; },
      findProblem: function(){ return titleInput.value.trim() ? "" : "The title is empty."; },
      describePostButton: function(){ return existingNumber ? "Update #" + existingNumber + " on GitHub" : "Post to GitHub"; },
      describeConfirmButton: function(){ return existingNumber ? "Update pull request" : "Create pull request"; },
      describeConfirmation: function(){
        if (existingNumber) return "Replace the title and description of #" + existingNumber + " on " + draft.repository + " with this draft?";
        var draftNote = readState().isDraft ? "a draft pull request" : "a pull request";
        return "Push " + draft.head + " to origin, then open " + draftNote + " into " + draft.base + " on " + draft.repository + "?";
      },
      buildPayload: readState,
      showPosted: function(answer){
        var wasUpdate = Boolean(existingNumber);
        var numberMatch = /\/pull\/(\d+)/.exec(answer.url || "");
        if (numberMatch) existingNumber = Number(numberMatch[1]);
        if (draftCheckbox) draftCheckbox.disabled = true;
        showNotice("success", wasUpdate ? "Pull request updated." : "Pull request created.", "", answer.url, "Open it on GitHub ↗");
      }
    });
  }

  function setUpReviewPage(){
    var labelTones = JSON.parse(document.body.dataset.labelTones);
    var cards = listAll(".comment");
    var summaryInput = findById("review-summary");
    var summaryPreview = findById("summary-preview");
    var filterNav = findById("label-filters");
    var editAllButton = findById("toggle-edit-all");
    var activeFilter = "all";
    var isPosted = false;

    function readCard(card){
      return {
        label: card.querySelector('[data-field="label"]').value,
        decorations: listAll('.chip[aria-pressed="true"]', card).map(function(chip){ return chip.dataset.decoration; }),
        subject: card.querySelector('[data-field="subject"]').value.trim(),
        discussion: card.querySelector('[data-field="discussion"]').value.trim(),
        isIncluded: card.querySelector("[data-include]").checked
      };
    }
    function applyCard(card, comment){
      card.querySelector('[data-field="label"]').value = comment.label;
      card.querySelector('[data-field="subject"]').value = comment.subject;
      card.querySelector('[data-field="discussion"]').value = comment.discussion;
      card.querySelector("[data-include]").checked = comment.isIncluded;
      listAll(".chip", card).forEach(function(chip){
        chip.setAttribute("aria-pressed", String(comment.decorations.indexOf(chip.dataset.decoration) !== -1));
      });
    }
    function formatComment(comment){
      var decorationText = comment.decorations.length ? " (" + comment.decorations.join(", ") + ")" : "";
      var subjectLine = "**" + comment.label + decorationText + ":** " + comment.subject;
      return comment.discussion ? subjectLine + "\n\n" + comment.discussion : subjectLine;
    }
    function readEvent(){
      var checkedEvent = document.querySelector('input[name="review-event"]:checked');
      return checkedEvent ? checkedEvent.value : "COMMENT";
    }
    function readState(){
      return { summary: summaryInput.value, event: readEvent(), comments: cards.map(readCard) };
    }
    function applyState(state){
      summaryInput.value = state.summary;
      listAll('input[name="review-event"]').forEach(function(eventInput){ eventInput.checked = eventInput.value === state.event; });
      cards.forEach(function(card, cardIndex){ if (state.comments[cardIndex]) applyCard(card, state.comments[cardIndex]); });
    }
    function buildBadge(text, toneClass, isBlocking){
      var badge = document.createElement("span");
      badge.className = "badge" + (isBlocking ? " is-blocking" : "");
      if (toneClass) {
        var dot = document.createElement("span");
        dot.className = "dot " + toneClass;
        badge.appendChild(dot);
      }
      badge.appendChild(document.createTextNode(text));
      return badge;
    }
    function refreshCard(card, comment){
      var badges = card.querySelector(".comment-badges");
      card.dataset.label = comment.label;
      badges.textContent = "";
      badges.appendChild(buildBadge(comment.label, "tone-" + (labelTones[comment.label] || "gray"), false));
      comment.decorations.forEach(function(decoration){ badges.appendChild(buildBadge(decoration, "", decoration === "blocking")); });
      card.querySelector(".comment-preview").innerHTML = renderMarkdown(formatComment(comment));
      card.classList.toggle("is-excluded", !comment.isIncluded);
    }
    function buildFilterTab(filter, tabLabel, commentCount){
      var tab = document.createElement("button");
      tab.type = "button";
      tab.className = "tab" + (filter === activeFilter ? " is-active" : "");
      tab.dataset.filter = filter;
      if (filter !== "all") {
        var dot = document.createElement("span");
        dot.className = "dot tone-" + (labelTones[filter] || "gray");
        tab.appendChild(dot);
      }
      tab.appendChild(document.createTextNode(tabLabel + " "));
      var countLabel = document.createElement("span");
      countLabel.className = "count";
      countLabel.textContent = commentCount;
      tab.appendChild(countLabel);
      return tab;
    }
    function refreshFilters(comments){
      var countByLabel = {};
      comments.forEach(function(comment){ countByLabel[comment.label] = (countByLabel[comment.label] || 0) + 1; });
      if (activeFilter !== "all" && !countByLabel[activeFilter]) activeFilter = "all";
      filterNav.textContent = "";
      filterNav.appendChild(buildFilterTab("all", "All", comments.length));
      Object.keys(labelTones).forEach(function(label){
        if (countByLabel[label]) filterNav.appendChild(buildFilterTab(label, label, countByLabel[label]));
      });
      cards.forEach(function(card){
        card.classList.toggle("is-hidden", activeFilter !== "all" && card.dataset.label !== activeFilter);
      });
      listAll(".file-group").forEach(function(group){
        group.classList.toggle("is-hidden", !group.querySelector(".comment:not(.is-hidden)"));
      });
    }
    var originalState = readState();
    function refresh(){
      var state = readState();
      var includedComments = state.comments.filter(function(comment){ return comment.isIncluded; });
      var isEdited = JSON.stringify(state) !== JSON.stringify(originalState);
      cards.forEach(function(card, cardIndex){ refreshCard(card, state.comments[cardIndex]); });
      refreshFilters(state.comments);
      summaryPreview.innerHTML = renderMarkdown(state.summary);
      findById("stat-included").textContent = includedComments.length + " / " + state.comments.length;
      findById("stat-blocking").textContent = includedComments.filter(function(comment){ return comment.decorations.indexOf("blocking") !== -1; }).length;
      showEditedState(isEdited);
      if (isEdited) saveState(state); else forgetSavedState();
    }
    function setCardEditing(card, isEditing){
      var form = card.querySelector(".comment-form");
      form.classList.toggle("is-hidden", !isEditing);
      card.querySelector('[data-action="edit-comment"]').textContent = isEditing ? "Done" : "Edit";
      if (isEditing) growToContent(card.querySelector('[data-field="discussion"]'));
      var isAnyClosed = cards.some(function(otherCard){ return otherCard.querySelector(".comment-form").classList.contains("is-hidden"); });
      editAllButton.textContent = isAnyClosed ? "Edit all" : "Close all";
    }
    function setSummaryView(view){
      summaryInput.classList.toggle("is-hidden", view !== "write");
      summaryPreview.classList.toggle("is-hidden", view !== "preview");
      listAll("[data-summary-view]").forEach(function(tab){ tab.classList.toggle("is-active", tab.dataset.summaryView === view); });
    }

    var savedState = loadSavedState();
    if (savedState && Array.isArray(savedState.comments) && savedState.comments.length === cards.length) applyState(savedState);

    cards.forEach(function(card){
      card.addEventListener("input", function(event){
        if (event.target.dataset.field === "discussion") growToContent(event.target);
        refresh();
      });
      card.addEventListener("change", refresh);
      card.addEventListener("click", function(event){
        var chip = event.target.closest(".chip");
        var actionButton = event.target.closest("[data-action]");
        if (chip) {
          var isPressed = chip.getAttribute("aria-pressed") !== "true";
          var oppositeDecoration = { blocking: "non-blocking", "non-blocking": "blocking" }[chip.dataset.decoration];
          chip.setAttribute("aria-pressed", String(isPressed));
          if (isPressed && oppositeDecoration) listAll('.chip[data-decoration="' + oppositeDecoration + '"]', card).forEach(function(oppositeChip){ oppositeChip.setAttribute("aria-pressed", "false"); });
          refresh();
        }
        if (!actionButton) return;
        if (actionButton.dataset.action === "copy-comment") copyText(formatComment(readCard(card)), actionButton);
        if (actionButton.dataset.action === "edit-comment") setCardEditing(card, card.querySelector(".comment-form").classList.contains("is-hidden"));
      });
    });
    filterNav.addEventListener("click", function(event){
      var tab = event.target.closest("[data-filter]");
      if (!tab) return;
      activeFilter = tab.dataset.filter;
      refresh();
    });
    editAllButton.addEventListener("click", function(){
      var shouldOpen = editAllButton.textContent === "Edit all";
      cards.forEach(function(card){ setCardEditing(card, shouldOpen); });
    });
    summaryInput.addEventListener("input", function(){ growToContent(summaryInput); refresh(); });
    listAll('input[name="review-event"]').forEach(function(eventInput){ eventInput.addEventListener("change", refresh); });
    listAll("[data-summary-view]").forEach(function(tab){
      tab.addEventListener("click", function(){ setSummaryView(tab.dataset.summaryView); });
    });
    findById("copy-summary").addEventListener("click", function(event){ copyText(summaryInput.value, event.currentTarget); });
    resetButton.addEventListener("click", function(){ applyState(originalState); refresh(); showToast("Back to the original draft"); });

    setSummaryView("write");
    growToContent(summaryInput);
    refresh();

    function listIncludedCards(){
      return cards.filter(function(card){ return readCard(card).isIncluded; });
    }
    startPosting({
      isPostLocked: function(){ return isPosted; },
      findProblem: function(){
        var cardWithoutSubject = listIncludedCards().filter(function(card){ return !readCard(card).subject; })[0];
        if (cardWithoutSubject) return "A comment has no subject: " + cardWithoutSubject.dataset.place + ". Write one, or untick Include.";
        var hasNothingToSay = !summaryInput.value.trim() && !listIncludedCards().length && readEvent() !== "APPROVE";
        return hasNothingToSay ? "The review has no summary and no included comments." : "";
      },
      describePostButton: function(){ return isPosted ? "Posted" : "Post to GitHub"; },
      describeConfirmButton: function(){ return readEvent() === "PENDING" ? "Save pending review" : "Post review"; },
      describeConfirmation: function(){
        var commentCount = listIncludedCards().length;
        var commentText = commentCount === 1 ? "1 comment" : commentCount + " comments";
        var place = draft.repository + "#" + draft.number;
        if (readEvent() === "PENDING") return "Save a pending review with " + commentText + " on " + place + "? You finish and submit it on GitHub.";
        return "Post a review with " + commentText + " as “" + EVENT_NAMES[readEvent()] + "” on " + place + "?";
      },
      buildPayload: function(){
        return {
          event: readEvent(),
          summary: summaryInput.value,
          comments: listIncludedCards().map(function(card){ return { index: Number(card.dataset.index), body: formatComment(readCard(card)) }; })
        };
      },
      showPosted: function(answer){
        isPosted = true;
        showNotice("success", readEvent() === "PENDING" ? "Pending review saved." : "Review posted.", "", answer.url || draft.url, "Open it on GitHub ↗");
      }
    });
  }

  if (draft.kind === "review") setUpReviewPage(); else setUpPullRequestPage();
})();
`;
