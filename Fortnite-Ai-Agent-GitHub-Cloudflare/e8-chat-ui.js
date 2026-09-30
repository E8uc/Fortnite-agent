const state = {
  layer: null,
  anchor: null
};

const styleReady =
  new Promise(
    (
      resolve,
      reject
    ) => {
      const existing =
        document.querySelector(
          'link[data-e8-chat-ui="1"]'
        );

      if (existing) {
        if (
          existing.sheet ||
          existing.dataset.loaded ===
            "1"
        ) {
          resolve();
          return;
        }

        existing.addEventListener(
          "load",
          resolve,
          {
            once: true
          }
        );

        existing.addEventListener(
          "error",
          () =>
            reject(
              new Error(
                "E8 chat UI styles failed to load."
              )
            ),
          {
            once: true
          }
        );

        return;
      }

      const link =
        document.createElement(
          "link"
        );

      link.rel =
        "stylesheet";

      link.href =
        new URL(
          "e8-chat-ui.css?v=1",
          import.meta.url
        ).href;

      link.dataset.e8ChatUi =
        "1";

      link.addEventListener(
        "load",
        () => {
          link.dataset.loaded =
            "1";

          resolve();
        },
        {
          once: true
        }
      );

      link.addEventListener(
        "error",
        () =>
          reject(
            new Error(
              "E8 chat UI styles failed to load."
            )
          ),
        {
          once: true
        }
      );

      document.head.appendChild(
        link
      );
    }
  );

function iconMarkup(
  name,
  size = 20
) {
  const icons = {
    thumbUp:
      '<path d="M7 10v10"></path><path d="M11 10l3-7a3 3 0 0 1 3 3v4h4a2 2 0 0 1 1.9 2.6l-2 6A2 2 0 0 1 19 20H7a3 3 0 0 1-3-3v-4a3 3 0 0 1 3-3Z"></path>',

    thumbDown:
      '<path d="M17 14V4"></path><path d="M13 14l-3 7a3 3 0 0 1-3-3v-4H3a2 2 0 0 1-1.9-2.6l2-6A2 2 0 0 1 5 4h12a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3Z"></path>',

    pin:
      '<path d="M12 17v5"></path><path d="m5 17 5-5"></path><path d="M15 3l6 6-4 1-5 5-3-3 5-5Z"></path>',

    search:
      '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path>',

    pencil:
      '<path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"></path>',

    trash:
      '<path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 10v6M14 10v6"></path>',

    close:
      '<path d="M6 6l12 12M18 6 6 18"></path>'
  };

  return `<svg aria-hidden="true" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${icons[name] || ""}</svg>`;
}

export function close() {
  state.anchor
    ?.setAttribute?.(
      "aria-expanded",
      "false"
    );

  state.layer
    ?.remove?.();

  state.layer = null;
  state.anchor = null;
}

function positionPopover(
  menu,
  anchor
) {
  const rect =
    anchor.getBoundingClientRect();

  const box =
    menu.getBoundingClientRect();

  const edge = 10;
  const gap = 8;

  let left =
    rect.right -
    box.width;

  left =
    Math.max(
      edge,
      Math.min(
        left,
        window.innerWidth -
          box.width -
          edge
      )
    );

  let top =
    rect.bottom +
    gap;

  if (
    top + box.height >
    window.innerHeight -
      edge
  ) {
    top =
      Math.max(
        edge,
        rect.top -
          box.height -
          gap
      );
  }

  menu.style.left =
    `${Math.round(left)}px`;

  menu.style.top =
    `${Math.round(top)}px`;
}

function openMenu(
  anchor,
  items,
  className = ""
) {
  close();

  const layer =
    document.createElement(
      "div"
    );

  layer.className =
    "e8-popover-layer";

  const menu =
    document.createElement(
      "div"
    );

  menu.className =
    `e8-popover ${className}`
      .trim();

  menu.setAttribute(
    "role",
    "menu"
  );

  for (const item of items) {
    const button =
      document.createElement(
        "button"
      );

    button.type =
      "button";

    button.className =
      `e8-menu-item${item.dangerous ? " dangerous" : ""}${item.active ? " active" : ""}`;

    button.setAttribute(
      "role",
      "menuitem"
    );

    const icon =
      document.createElement(
        "span"
      );

    icon.className =
      "e8-menu-icon";

    icon.innerHTML =
      iconMarkup(
        item.icon,
        21
      );

    const label =
      document.createElement(
        "span"
      );

    label.className =
      "e8-menu-label";

    label.textContent =
      item.label;

    button.append(
      icon,
      label
    );

    button.addEventListener(
      "click",
      () => {
        close();
        item.onSelect?.();
      }
    );

    menu.appendChild(
      button
    );
  }

  layer.appendChild(
    menu
  );

  layer.addEventListener(
    "pointerdown",
    (event) => {
      if (
        event.target ===
        layer
      ) {
        close();
      }
    }
  );

  document.body.appendChild(
    layer
  );

  state.layer = layer;
  state.anchor = anchor;

  anchor.setAttribute(
    "aria-expanded",
    "true"
  );

  requestAnimationFrame(
    () =>
      positionPopover(
        menu,
        anchor
      )
  );
}

function openDialog(
  title,
  labels
) {
  close();

  const layer =
    document.createElement(
      "div"
    );

  layer.className =
    "e8-dialog-layer";

  const card =
    document.createElement(
      "section"
    );

  card.className =
    "e8-dialog-card";

  card.setAttribute(
    "role",
    "dialog"
  );

  card.setAttribute(
    "aria-modal",
    "true"
  );

  const header =
    document.createElement(
      "div"
    );

  header.className =
    "e8-dialog-header";

  const heading =
    document.createElement(
      "h2"
    );

  heading.textContent =
    title;

  const closeButton =
    document.createElement(
      "button"
    );

  closeButton.type =
    "button";

  closeButton.className =
    "e8-dialog-close";

  closeButton.innerHTML =
    iconMarkup(
      "close",
      20
    );

  closeButton.setAttribute(
    "aria-label",
    labels.close
  );

  closeButton.addEventListener(
    "click",
    close
  );

  header.append(
    heading,
    closeButton
  );

  card.appendChild(
    header
  );

  layer.appendChild(
    card
  );

  layer.addEventListener(
    "pointerdown",
    (event) => {
      if (
        event.target ===
        layer
      ) {
        close();
      }
    }
  );

  document.body.appendChild(
    layer
  );

  state.layer = layer;

  return card;
}

function openRename(
  options
) {
  const {
    title,
    currentTitle,
    labels,
    onRename
  } = options;

  const card =
    openDialog(
      title,
      labels
    );

  const input =
    document.createElement(
      "input"
    );

  input.className =
    "e8-dialog-input";

  input.value =
    currentTitle || "";

  input.maxLength = 96;

  const actions =
    document.createElement(
      "div"
    );

  actions.className =
    "e8-dialog-actions";

  const cancel =
    document.createElement(
      "button"
    );

  cancel.type =
    "button";

  cancel.className =
    "e8-dialog-button";

  cancel.textContent =
    labels.cancel;

  cancel.addEventListener(
    "click",
    close
  );

  const save =
    document.createElement(
      "button"
    );

  save.type =
    "button";

  save.className =
    "e8-dialog-button primary";

  save.textContent =
    labels.save;

  const commit =
    () => {
      const next =
        input.value
          .replace(
            /\s+/g,
            " "
          )
          .trim()
          .slice(
            0,
            96
          );

      if (!next) return;

      close();
      onRename?.(next);
    };

  save.addEventListener(
    "click",
    commit
  );

  input.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key ===
        "Enter"
      ) {
        event.preventDefault();
        commit();
      }
    }
  );

  actions.append(
    cancel,
    save
  );

  card.append(
    input,
    actions
  );

  requestAnimationFrame(
    () => {
      input.focus();
      input.select();
    }
  );
}

function openDelete(
  options
) {
  const {
    title,
    note,
    labels,
    onDelete
  } = options;

  const card =
    openDialog(
      title,
      labels
    );

  const message =
    document.createElement(
      "p"
    );

  message.className =
    "e8-dialog-note";

  message.textContent =
    note;

  const actions =
    document.createElement(
      "div"
    );

  actions.className =
    "e8-dialog-actions";

  const cancel =
    document.createElement(
      "button"
    );

  cancel.type =
    "button";

  cancel.className =
    "e8-dialog-button";

  cancel.textContent =
    labels.cancel;

  cancel.addEventListener(
    "click",
    close
  );

  const remove =
    document.createElement(
      "button"
    );

  remove.type =
    "button";

  remove.className =
    "e8-dialog-button dangerous";

  remove.textContent =
    labels.delete;

  remove.addEventListener(
    "click",
    () => {
      close();
      onDelete?.();
    }
  );

  actions.append(
    cancel,
    remove
  );

  card.append(
    message,
    actions
  );
}

function openFind(
  options
) {
  const {
    title,
    messages,
    labels,
    onSelect
  } = options;

  const card =
    openDialog(
      title,
      labels
    );

  const input =
    document.createElement(
      "input"
    );

  input.className =
    "e8-dialog-input";

  input.placeholder =
    labels.searchMessages;

  const results =
    document.createElement(
      "div"
    );

  results.className =
    "e8-find-results";

  const render =
    () => {
      results.replaceChildren();

      const query =
        input.value
          .trim()
          .toLocaleLowerCase();

      if (!query) return;

      const matches =
        messages
          .map(
            (message, index) => ({
              message,
              index
            })
          )
          .filter(
            ({ message }) =>
              String(
                message.content ||
                ""
              )
                .toLocaleLowerCase()
                .includes(
                  query
                )
          )
          .slice(0, 40);

      if (!matches.length) {
        const empty =
          document.createElement(
            "div"
          );

        empty.className =
          "e8-find-empty";

        empty.textContent =
          labels.noResults;

        results.appendChild(
          empty
        );

        return;
      }

      for (
        const {
          message,
          index
        } of matches
      ) {
        const row =
          document.createElement(
            "button"
          );

        row.type =
          "button";

        row.className =
          "e8-find-result";

        const who =
          document.createElement(
            "strong"
          );

        who.textContent =
          message.role ===
          "assistant"
            ? "E8"
            : labels.you;

        const snippet =
          document.createElement(
            "span"
          );

        const compact =
          String(
            message.content ||
            ""
          )
            .replace(
              /\s+/g,
              " "
            )
            .trim();

        snippet.textContent =
          compact.length > 150
            ? compact.slice(
                0,
                150
              ) + "…"
            : compact;

        row.append(
          who,
          snippet
        );

        row.addEventListener(
          "click",
          () => {
            close();
            onSelect?.(index);
          }
        );

        results.appendChild(
          row
        );
      }
    };

  input.addEventListener(
    "input",
    render
  );

  card.append(
    input,
    results
  );

  requestAnimationFrame(
    () =>
      input.focus()
  );
}

export async function openFeedbackMenu(
  options
) {
  await styleReady;
  const {
    anchor,
    currentRating = "",
    labels,
    onRate
  } = options;

  openMenu(
    anchor,
    [
      {
        icon: "thumbUp",
        label:
          labels.goodResponse,
        active:
          currentRating ===
          "good",
        onSelect:
          () =>
            onRate?.("good")
      },
      {
        icon: "thumbDown",
        label:
          labels.badResponse,
        active:
          currentRating ===
          "bad",
        onSelect:
          () =>
            onRate?.("bad")
      }
    ],
    "e8-feedback-menu"
  );
}

export async function openChatMenu(
  options
) {
  await styleReady;
  const {
    anchor,
    pinned = false,
    title = "",
    messages = [],
    labels,
    onTogglePin,
    onRename,
    onDelete,
    onFindSelect
  } = options;

  openMenu(
    anchor,
    [
      {
        icon: "pin",
        label:
          pinned
            ? labels.unpinChat
            : labels.pinChat,
        active:
          pinned,
        onSelect:
          onTogglePin
      },
      {
        icon: "search",
        label:
          labels.findInChat,
        onSelect:
          () =>
            openFind({
              title:
                labels.findInChat,
              messages,
              labels,
              onSelect:
                onFindSelect
            })
      },
      {
        icon: "pencil",
        label:
          labels.rename,
        onSelect:
          () =>
            openRename({
              title:
                labels.renameChat,
              currentTitle:
                title,
              labels,
              onRename
            })
      },
      {
        icon: "trash",
        label:
          labels.deleteChat,
        dangerous: true,
        onSelect:
          () =>
            openDelete({
              title:
                labels.deleteChatQuestion,
              note:
                labels.deleteCannotUndo,
              labels,
              onDelete
            })
      }
    ],
    "e8-chat-menu"
  );
}
