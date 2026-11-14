-- Impossibility Simulator: seat teams, hand zones shared on a side, large cards resized out of containers, card details,
-- turn markers.
-- The save's global script: edit this file (TTS/Global.lua), never the save; Card sync writes it into the save.

-- Seat -> TTS team; other seats get "None"
local TEAMS = {
    Red  = "Hearts", Orange = "Hearts", Green = "Hearts",
    Blue = "Clubs",  Purple = "Clubs",  Pink  = "Clubs",
}

local LARGE_CARD_SCALE = {x=3, y=1, z=3}

-- Large cards by Nickname: the save updater (AutoCroissant tts_save) fills these rows from Auxiliary/Creatures
local resizeTargets = {
    ["Azamoth The Possessed Vessel"] = true,
    ["Igor Roballtowski"]            = true,
    ["Mettaton EX"]                  = true,
    ["Mettaton NEO"]                 = true,
    ["Militron (No Armor)"]          = true,
    ["Morpho Knight"]                = true,
    ["Shadow Queen"]                 = true,
}

-- Hand zones shared on a side: a zone belongs to its own seat's colour while someone sits there; a free seat's zones go
-- to the first seated teammate on its side (TEAMS order: Red, Orange, Green / Blue, Purple, Pink), so a player alone on
-- a side keeps cards in every hand zone there. Run on load and on every seat change; a zone's own colour is its owner in
-- the save the first time, kept in the script's saved state after.
local SIDE_ORDER = {Hearts = {"Red", "Orange", "Green"}, Clubs = {"Blue", "Purple", "Pink"}}
local zoneHome, zoneOwner = {}, {}                     -- hand zone GUID -> its own colour / its owner now

local function shareHands()
    local seated = {}
    for _, c in ipairs(getSeatedPlayers()) do seated[c] = true end
    local gained = {}                                  -- colour -> the seats whose zones it now holds
    for _, zone in ipairs(Hands.getHands()) do
        local guid = zone.getGUID()
        if not zoneOwner[guid] then zoneOwner[guid] = zone.getData().FogColor end
        zoneHome[guid] = zoneHome[guid] or zoneOwner[guid]
        local home = zoneHome[guid]
        local owner = home
        if TEAMS[home] and not seated[home] then
            for _, c in ipairs(SIDE_ORDER[TEAMS[home]]) do if seated[c] then owner = c break end end
        end
        if owner ~= zoneOwner[guid] then
            zone.setValue(owner)
            zoneOwner[guid] = owner
            if owner ~= home then gained[owner] = gained[owner] or {}; gained[owner][home] = true end
        end
    end
    for c, homes in pairs(gained) do
        local list = {}
        for h in pairs(homes) do table.insert(list, h) end
        table.sort(list)
        broadcastToColor("You hold " .. table.concat(list, " and ") .. "'s hand zones too (their seats are free).", c, {1, 1, 1})
    end
end

function onPlayerChangeColor(color)
    Wait.frames(shareHands, 2)                         -- any seat change, leaving one included
    seatPanels(color)
    if color == "Grey" or color == "Black" then return end
    local player = Player[color]
    if not player or not player.seated then return end
    local team = TEAMS[color]
    player.team = team or "None"
    if team then
        broadcastToAll(player.steam_name .. " joined " .. color .. " → assigned to " .. team .. ".", {r=1, g=1, b=1})
    end
end

function onPlayerDisconnect() Wait.frames(shareHands, 2) end

function onSave() return JSON.encode({zoneHome = zoneHome}) end

function onLoad(saved)
    local ok, state = pcall(JSON.decode, saved or "")
    if ok and type(state) == "table" and type(state.zoneHome) == "table" then zoneHome = state.zoneHome end
    -- players already seated, once the load settles
    Wait.time(function()
        for _, color in ipairs(getSeatedPlayers()) do
            onPlayerChangeColor(color)
        end
        shareHands()
    end, 1)
    loadCardDetails()
end

function onObjectLeaveContainer(container, obj)
    cardMenu(obj)                                      -- Card details on a card taken out of a deck or bag
    if obj.type ~= "Card" or not resizeTargets[obj.getName()] then return end
    -- after the take has placed it
    Wait.frames(function()
        if not obj.isDestroyed() then obj.setScale(LARGE_CARD_SCALE) end
    end, 3)
end

-- Card details: right-click a card > Card details, in hand too (right-click the table > Find a card: any card). Cards
-- spawned from the panels go into the player's hand. Panels only that player sees (up to three at once): drag one by its
-- title bar, A- / A+
-- size it (kept for the player), its Rules buttons open the rulebook PDF at a chapter, and the cards its text names
-- (status effects and others) spawn beside the card with a click; cards that draw from a kind of deck (DECKS) get a
-- button per deck that spawns a shuffled copy beside the card. The panel's text: the kind, stars and author, the stats,
-- then the ability, its words in the website's palette (painted: status words, stats with their numbers, counters; a
-- colour too dark for the panel in a lighter shade: build_site tts_seen). An ability with a status word, a timing tag
-- or a type's word is laid out line by line (abilityLines), each its own text with its rule on hover (no rule sections
-- below it); a type's word in its type's own colour (tts.json types ic: its icon's). A button whose name is cut short
-- shows the whole name on hover, clear of the buttons. Hover boxes: TIP.
-- Data: the website's data/tts.json and
-- TTS/Rulebook/pages.json, fetched a moment after the save loads; once tts.json is in, it is decoded and the seated
-- players' panels are built (a player seated later: a moment after sitting). No Lua patterns over long text (MoonSharp's
-- are limited): plain finds only.
local DETAILS_URL = "https://michaeljsr.github.io/TTSCardMaker/data/tts.json"
local PAGES_URL = "https://raw.githubusercontent.com/MichaelJSr/TTSCardMaker/main/TTS/Rulebook/pages.json"
local RAW_PREFIX = "https://raw.githubusercontent.com/"
local RAW_MAIN = "https://raw.githubusercontent.com/MichaelJSr/TTSCardMaker/main/"
local SEATS = {"White", "Brown", "Red", "Orange", "Yellow", "Green", "Teal", "Blue", "Purple", "Pink", "Grey", "Black"}
local BADGE = {turn = "#60a5fa", any = "#a78bfa", forced = "#f87171", trigger = "#fbbf24", neutral = "#cbd5e1"}
local DIM = "#94a3b8"
local SIZES = {{w = 440, h = 540, f = 14}, {w = 540, h = 660, f = 16}, {w = 660, h = 800, f = 18}}
local RULE_BUTTONS, CARD_BUTTONS, TITLE_H, ROW_H = 5, 6, 40, 30
local RULE_ROWS, CARD_ROWS = 3, 2                      -- rows the buttons may take (more than fit: names shortened)
local DECK_BUTTONS, DECK_ROWS = 8, 3
local DETAILS_PANELS = 3                               -- a player's card details open at once (one more replaces the oldest)
local ABILITY_LINES = 14                               -- per panel: plain ability lines
local ROW_SLOTS = {8, 7, 5, 4, 4, 3, 3}                -- per panel: rows for lines with a hover, each its texts (widest first)
local BACKS = {{"Buff", "MDW/Assets/cardback_statuseffect.png"}, {"Debuff", "MDW/Assets/cardback_statuseffect.png"},
    {"Creature", "MDW/Assets/cardback.png"}, {"Minion", "MDW/Assets/cardback.png"}, {"Auxiliary creature", "MDW/Assets/cardback.png"}}

local details, tagCase, chapterPage, pageOfTitle, bookPages = nil, {}, {}, {}, {}
local sizeOf, shown, opened, menued, cardIndex = {}, {}, 0, setmetatable({}, {__mode = "k"}), nil

local function decode(text)
    local ok, data = pcall(JSON.decode, text or "")
    return ok and type(data) == "table" and data or nil
end

local BUTTON = "#c7d2fe|#e0e7ff|#a5b4fc|#c7d2fe80"     -- light lavender (normal|hover|pressed|disabled), dark text
local SPAWN = "#bbf7d0|#dcfce7|#86efac|#bbf7d080"      -- the spawn buttons: light green
local DECK = "#fde68a|#fef3c7|#fcd34d|#fde68a80"       -- the deck buttons: light amber
-- every hover box, on each element that has one (TTS's tooltip is one box that keeps the last element's style): a plain
-- box (no sprite) with no fade-in (XmlLayout's stops short of full alpha), so opaque; a shade lighter than the panel,
-- a light border, white text; above what is hovered
local TIP = {tooltipPosition = "Above", tooltipBackgroundColor = "#1b2740", tooltipBackgroundImage = "none",
    tooltipBorderColor = "#7dd3fc", tooltipTextColor = "#ffffff", tooltipFadeTime = "0"}
local function button(id, label, onClick, attrs)
    local a = {id = id, onClick = onClick, fontSize = 13, textColor = "#0f172a", colors = BUTTON}
    for k, v in pairs(attrs or {}) do a[k] = v end
    return {tag = "Button", attributes = a, value = label}
end

-- n buttons on up to count rows "<id>1".."<id><count>": button i goes in row i at the latest, so row r holds slots
-- "<prefix><r>_<i>" for i = r..n (layout puts each button in one of them)
local function rows(id, prefix, n, count, onClick, colors)
    local out = {}
    for r = 1, count do
        local row = {tag = "HorizontalLayout", attributes = {id = id .. r, rectAlignment = "LowerLeft", height = ROW_H, spacing = 6,
            childForceExpandWidth = false, childAlignment = "MiddleLeft", active = false}, children = {}}
        for i = r, n do
            local a = {preferredWidth = 120, active = false, colors = colors or BUTTON}
            for k, v in pairs(TIP) do a[k] = v end
            table.insert(row.children, button(prefix .. r .. "_" .. i, "", onClick, a))
        end
        table.insert(out, row)
    end
    return out
end

-- a panel's page: the details text, the ability's lines when laid out by layout() (plain lines, then lines with a hover:
-- a row of texts, each status word, timing tag and type word its own with its rule on hover)
local function abilityPool(id)
    local function text(tid, attrs)
        local a = {id = tid, rectAlignment = "UpperLeft", offsetXY = "14 -6", color = "#e8edf5", alignment = "UpperLeft",
            horizontalOverflow = "Overflow", verticalOverflow = "Overflow", active = false}
        for k, v in pairs(attrs or {}) do a[k] = v end
        return {tag = "Text", attributes = a, value = ""}
    end
    local page = {text(id .. "_text", {horizontalOverflow = "Wrap", active = true})}
    for i = 1, ABILITY_LINES do table.insert(page, text(id .. "_al" .. i)) end
    for i, slots in ipairs(ROW_SLOTS) do
        local row = {tag = "HorizontalLayout", attributes = {id = id .. "_as" .. i, rectAlignment = "UpperLeft", offsetXY = "14 -6",
            childForceExpandWidth = false, childForceExpandHeight = true, childAlignment = "UpperLeft", active = false}, children = {}}
        for j = 1, slots do
            local a = {flexibleWidth = 0, tooltipOffset = 6}   -- as wide as its text (Unity's own measure); the box just above
            for k, v in pairs(TIP) do a[k] = v end
            table.insert(row.children, text(id .. "_as" .. i .. "_" .. j, a))
        end
        table.insert(page, row)
    end
    return page
end

-- one of a seat's details panels, k (its children placed by layout(), below); each a little further in than the last;
-- opaque: build_site TTS_BACK checks the palette's colours against it
local function detailsPanel(c, k)
    local id = c .. "_d" .. k
    local panel = {tag = "Panel", attributes = {id = id, visibility = c, active = false, allowDragging = true,
        returnToOriginalPositionWhenReleased = false, rectAlignment = "MiddleRight", offsetXY = (-60 - 50 * (k - 1)) .. " " .. (-40 * (k - 1)), width = 540, height = 660,
        color = "#0f1729", outline = "#3b4b6b", outlineSize = "2 -2"}, children = {
        {tag = "Panel", attributes = {id = id .. "_head", rectAlignment = "UpperCenter", height = TITLE_H, color = "#1b2740"}, children = {
            {tag = "Text", attributes = {id = id .. "_title", rectAlignment = "MiddleLeft", offsetXY = "12 0", height = TITLE_H,
                fontStyle = "Bold", color = "#ffffff", alignment = "MiddleLeft", horizontalOverflow = "Overflow"}, value = ""},
            button(id .. "_smaller", "A-", "detailsSize", {rectAlignment = "MiddleRight", offsetXY = "-84 0", width = 36, height = 28}),
            button(id .. "_bigger", "A+", "detailsSize", {rectAlignment = "MiddleRight", offsetXY = "-44 0", width = 36, height = 28}),
            button(id .. "_close", "X", "closeDetails", {rectAlignment = "MiddleRight", offsetXY = "-4 0", width = 36, height = 28})}},
        {tag = "VerticalScrollView", attributes = {id = id .. "_scroll", rectAlignment = "UpperCenter", offsetXY = "0 -" .. (TITLE_H + 4),
            color = "#00000000", scrollSensitivity = 30, horizontalScrollbarVisibility = "AutoHideAndExpandViewport",
            verticalScrollbarVisibility = "AutoHideAndExpandViewport"}, children = {
            {tag = "Panel", attributes = {id = id .. "_page", height = 100}, children = abilityPool(id)}}}}}
    for _, r in ipairs(rows(id .. "_rules", id .. "_r", RULE_BUTTONS, RULE_ROWS, "openRules")) do table.insert(panel.children, r) end
    for _, r in ipairs(rows(id .. "_cards", id .. "_c", CARD_BUTTONS, CARD_ROWS, "spawnNamed", SPAWN)) do table.insert(panel.children, r) end
    for _, r in ipairs(rows(id .. "_decks", id .. "_k", DECK_BUTTONS, DECK_ROWS, "spawnDeck", DECK)) do table.insert(panel.children, r) end
    return panel
end

-- one seat's rulebook panel: a search box, then the chapters (or the pages a search finds) as buttons
local RESULTS = 24                                   -- the contents (23 chapters and the contents page) fit; a search shows that many
local function rulebookPanel(c)
    local id = c .. "_rb"
    local list = {tag = "VerticalLayout", attributes = {id = id .. "_list", height = 100, spacing = 3, padding = "6 10 4 4",
        childForceExpandHeight = false, childAlignment = "UpperLeft"}, children = {}}
    for i = 1, RESULTS do
        table.insert(list.children, button(id .. "_g" .. i, "", "rulebookGo", {preferredHeight = 30, fontSize = 14, textAlignment = "MiddleLeft", active = false}))
    end
    return {tag = "Panel", attributes = {id = id, visibility = c, active = false, allowDragging = true,
        returnToOriginalPositionWhenReleased = false, rectAlignment = "MiddleLeft", offsetXY = "60 0", width = 460, height = 640,
        color = "#0f1729F2", outline = "#3b4b6b", outlineSize = "2 -2"}, children = {
        {tag = "Panel", attributes = {rectAlignment = "UpperCenter", height = TITLE_H, color = "#1b2740"}, children = {
            {tag = "Text", attributes = {id = id .. "_title", rectAlignment = "MiddleLeft", offsetXY = "12 0", width = 360, height = TITLE_H,
                fontSize = 17, fontStyle = "Bold", color = "#ffffff", alignment = "MiddleLeft"}, value = "Rulebook"},
            button(id .. "_close", "X", "closeRulebook", {rectAlignment = "MiddleRight", offsetXY = "-4 0", width = 36, height = 28})}},
        {tag = "InputField", attributes = {id = id .. "_q", rectAlignment = "UpperCenter", offsetXY = "0 -" .. (TITLE_H + 8), width = 436,
            height = 34, fontSize = 15, placeholder = "Search the rulebook...", onValueChanged = "rulebookSearch"}},
        {tag = "VerticalScrollView", attributes = {id = id .. "_scroll", rectAlignment = "UpperCenter", offsetXY = "0 -" .. (TITLE_H + 50),
            width = 452, height = 640 - TITLE_H - 58, color = "#00000000", scrollSensitivity = 30,
            horizontalScrollbarVisibility = "AutoHideAndExpandViewport", verticalScrollbarVisibility = "AutoHideAndExpandViewport"}, children = {list}}}}
end

-- one seat's card finder: a search box (name, kind, type, timing tag), then the cards found as buttons
local function finderPanel(c)
    local id = c .. "_fc"
    local list = {tag = "VerticalLayout", attributes = {id = id .. "_list", height = 100, spacing = 3, padding = "6 10 4 4",
        childForceExpandHeight = false, childAlignment = "UpperLeft"}, children = {}}
    for i = 1, RESULTS do
        table.insert(list.children, button(id .. "_g" .. i, "", "finderGo", {preferredHeight = 30, fontSize = 14, textAlignment = "MiddleLeft", active = false}))
    end
    return {tag = "Panel", attributes = {id = id, visibility = c, active = false, allowDragging = true,
        returnToOriginalPositionWhenReleased = false, rectAlignment = "MiddleLeft", offsetXY = "110 -30", width = 460, height = 640,
        color = "#0f1729F2", outline = "#3b4b6b", outlineSize = "2 -2"}, children = {
        {tag = "Panel", attributes = {rectAlignment = "UpperCenter", height = TITLE_H, color = "#1b2740"}, children = {
            {tag = "Text", attributes = {id = id .. "_title", rectAlignment = "MiddleLeft", offsetXY = "12 0", width = 360, height = TITLE_H,
                fontSize = 17, fontStyle = "Bold", color = "#ffffff", alignment = "MiddleLeft"}, value = "Find a card"},
            button(id .. "_close", "X", "closeFinder", {rectAlignment = "MiddleRight", offsetXY = "-4 0", width = 36, height = 28})}},
        {tag = "InputField", attributes = {id = id .. "_q", rectAlignment = "UpperCenter", offsetXY = "0 -" .. (TITLE_H + 8), width = 436,
            height = 34, fontSize = 15, placeholder = "Name, kind, stars, type or tag...", onValueChanged = "finderSearch"}},
        {tag = "VerticalScrollView", attributes = {id = id .. "_scroll", rectAlignment = "UpperCenter", offsetXY = "0 -" .. (TITLE_H + 50),
            width = 452, height = 640 - TITLE_H - 58, color = "#00000000", scrollSensitivity = 30,
            horizontalScrollbarVisibility = "AutoHideAndExpandViewport", verticalScrollbarVisibility = "AutoHideAndExpandViewport"}, children = {list}}}}
end

-- Panels are built for seated players only: TTS sets the whole UI at once, so building every seat's (1,100 elements)
-- stalled the game. A build keeps the save's own UI and the panels already built; the panels open at the time are drawn
-- again after it (a dragged one back at its place).
local baseXml, built, rbOpen, restoring, ensurePanels = nil, {}, {}, false, nil

-- the panels' attributes and values as last set: set() sends only what changed, an element's changes in one call (each
-- call crosses into the game); a rebuild starts the panels afresh. The search boxes' text is the player's: set directly
local uiNow = {}
local function set(id, attrs)
    local now, changed = uiNow[id], nil
    if not now then now = {} uiNow[id] = now end
    for k, v in pairs(attrs) do
        v = tostring(v)
        if now[k] ~= v then now[k] = v changed = changed or {} changed[k] = v end
    end
    if changed then UI.setAttributes(id, changed) end
end
local function setValue(id, v)
    local now = uiNow[id]
    if not now then now = {} uiNow[id] = now end
    if now["@value"] ~= v then now["@value"] = v UI.setValue(id, v) end
end

local function rebuild()
    uiNow = {}
    baseXml = baseXml or UI.getXmlTable() or {}
    local xml = {}
    for _, e in ipairs(baseXml) do table.insert(xml, e) end
    for _, c in ipairs(SEATS) do
        if built[c] then
            for k = 1, DETAILS_PANELS do table.insert(xml, detailsPanel(c, k)) end
            table.insert(xml, rulebookPanel(c))
            table.insert(xml, finderPanel(c))
        end
    end
    UI.setXmlTable(xml)
    for _, c in ipairs(SEATS) do                       -- the ability pools start hidden: nothing sent to hide them
        if built[c] then
            for k = 1, DETAILS_PANELS do
                local id = c .. "_d" .. k
                for i = 1, ABILITY_LINES do uiNow[id .. "_al" .. i] = {active = "false"} end
                for i, slots in ipairs(ROW_SLOTS) do
                    uiNow[id .. "_as" .. i] = {active = "false"}
                    for j = 1, slots do uiNow[id .. "_as" .. i .. "_" .. j] = {active = "false"} end
                end
            end
        end
    end
end

-- the fetched data, decoded once it is in (prepare) or when first needed
local detailsRaw, pagesRaw = nil, nil
local function ensureData()
    if detailsRaw then
        local data = decode(detailsRaw)
        detailsRaw = nil
        if data and data.cards then
            for tag in pairs(data.tags or {}) do tagCase[tag:upper()] = tag end
            details = data
        else
            log("Card details: data/tts.json not readable")
        end
    end
    if pagesRaw then
        local book = decode(pagesRaw)
        pagesRaw = nil
        for i, page in ipairs(book and book.pages or {}) do
            local num = tonumber(page.num)
            if num and num == math.floor(num) and chapterPage[num] == nil then chapterPage[num] = i - 1 end
            if page.name and pageOfTitle[page.name] == nil then pageOfTitle[page.name] = i - 1 end
            table.insert(bookPages, {name = page.name or "", num = page.num or "", page = i - 1, text = page.t or "", low = (page.t or ""):lower(),
                chapter = num and num == math.floor(num) or page.name == "Table of Contents"})
        end
    end
end

-- right-click > Card details on every card (loose ones at load, others as they come out of decks and bags)
local function addMenu(obj)
    if obj == nil or menued[obj] then return end
    if obj.type == "Card" then
        menued[obj] = true
        obj.addContextMenuItem("Card details", function(color) showDetails(color, obj) end)
    elseif (obj.name == "Custom_PDF" and obj.getName() == "Rulebook") or (obj.type == "Bag" and obj.getName() == "Rulebooks") then
        menued[obj] = true
        obj.addContextMenuItem("Contents and search", function(color) openRulebook(color) end)
    end
end

function loadCardDetails()
    Wait.time(function()                               -- a moment after the load: the menus and the downloads only
        baseXml = UI.getXmlTable() or {}
        for _, obj in ipairs(getObjects()) do addMenu(obj) end
        addContextMenuItem("Find a card", function(color, at) openFinder(color, at) end)   -- right-click the table
        WebRequest.get(DETAILS_URL, function(r)
            if r.is_error then log("Card details: not loaded (" .. tostring(r.error) .. ")") return end
            detailsRaw = r.text
            Wait.time(prepare, 2)
        end)
        WebRequest.get(PAGES_URL, function(r) if not r.is_error then pagesRaw = r.text end end)
    end, 3)
end

-- the GUI a moment after the load, so a first right-click doesn't wait: the data decoded, the seated players' panels built
function prepare()
    ensureData()
    if details then
        ensurePanels(getSeatedPlayers())
        Wait.time(indexLater, 1)                       -- then the save's cards, for the spawn buttons
    end
end

function seatPanels(color)                             -- a player seated after that: theirs a moment later
    if details and color ~= "Grey" and not built[color] then
        Wait.time(function() if Player[color] and Player[color].seated then ensurePanels(color) end end, 2)
    end
end

function onObjectSpawn(obj) addMenu(obj) end
function cardMenu(obj) addMenu(obj) end                -- for the handlers above this section
function onObjectEnterZone(zone, obj) if zone.type == "Hand" then addMenu(obj) end end   -- cards drawn into a hand

-- %XX escapes decoded (no patterns)
local function unescape(s)
    local out, i = {}, 1
    while true do
        local j = s:find("%", i, true)
        if not j then table.insert(out, s:sub(i)) break end
        table.insert(out, s:sub(i, j - 1))
        local code = tonumber(s:sub(j + 1, j + 2), 16)
        table.insert(out, code and string.char(code) or "%")
        i = code and j + 3 or j + 1
    end
    return table.concat(out)
end

-- a repo link's path (raw.githubusercontent.com/owner/repo/ref/<path>), or nil
local function pathOf(url)
    if not url or url:sub(1, #RAW_PREFIX) ~= RAW_PREFIX then return nil end
    local at = #RAW_PREFIX + 1
    for _ = 1, 3 do
        local slash = url:find("/", at, true)
        if not slash then return nil end
        at = slash + 1
    end
    return unescape(url:sub(at))
end

local function handOf(c)                               -- objects in all of a seat's hand zones ({} for none)
    local out = {}
    local ok, n = pcall(function() return Player[c].getHandCount() end)
    for i = 1, ok and tonumber(n) or 1 do
        local fine, objs = pcall(function() return Player[c].getHandObjects(i) end)
        for _, o in ipairs(fine and objs or {}) do table.insert(out, o) end
    end
    return out
end

-- the card's PNG path, or nil (not a card, or hidden from this player: face down or in another player's hand)
local function cardPath(obj, color)
    if obj == nil or obj.isDestroyed() or obj.type ~= "Card" or obj.is_face_down then return nil end
    for _, other in ipairs(getSeatedPlayers()) do
        if other ~= color then
            for _, o in ipairs(handOf(other)) do
                if o == obj then return nil end
            end
        end
    end
    local url = (obj.getCustomObject() or {}).face
    if not url then
        for _, deck in pairs(obj.getData().CustomDeck or {}) do url = deck.FaceURL break end
    end
    return pathOf(url)
end

-- text shown as it is: rich text has no escape, so each "<" gets an empty <b></b> after it (never the start of a tag)
local function plain(text)
    local out, i = {}, 1
    while true do
        local lt = text:find("<", i, true)
        if not lt then table.insert(out, text:sub(i)) break end
        table.insert(out, text:sub(i, lt) .. "<b></b>")
        i = lt + 1
    end
    return table.concat(out)
end

-- lowercase text's punctuation (and its spaces, unless spaces) as gap: "mom's" -> "moms" (gap ""), "a/b" -> "a b" (gap " ")
local function unpunct(text, gap, spaces)
    local out, from = {}, 1
    for i = 1, #text do
        local b = text:byte(i)
        if b < 128 and not (b >= 97 and b <= 122 or b >= 48 and b <= 57 or spaces and b == 32) then
            out[#out + 1] = text:sub(from, i - 1) .. gap
            from = i + 1
        end
    end
    out[#out + 1] = text:sub(from)
    return table.concat(out)
end

local HEX = {}
for i = 1, 16 do HEX[("0123456789abcdef"):sub(i, i)] = true end
local function hexColour(c)                            -- "#rrggbb", else nil
    if type(c) ~= "string" or #c ~= 7 or c:sub(1, 1) ~= "#" then return nil end
    for i = 2, 7 do if not HEX[c:sub(i, i)] then return nil end end
    return c
end

-- text (plain) in the website's palette (tts.json ac: {piece, "#rrggbb", n}, in order: piece's nth find after the last
-- one, n 1 when left out; found by text, as MoonSharp's strings aren't bytes)
local function painted(text, pieces)
    local out, at = {}, 1
    for _, p in ipairs(type(pieces) == "table" and pieces or {}) do
        local piece, c, s = type(p) == "table" and p[1], type(p) == "table" and hexColour(p[2]), nil
        if type(piece) == "string" and piece ~= "" and c then
            local from = at
            for _ = 1, math.max(1, math.floor(tonumber(p[3]) or 1)) do
                s = text:find(piece, from, true)
                if not s then break end
                from = s + 1
            end
        end
        if s then
            table.insert(out, plain(text:sub(at, s - 1)) .. "<color=" .. c .. ">" .. plain(piece) .. "</color>")
            at = s + #piece
        end
    end
    table.insert(out, plain(text:sub(at)))
    return table.concat(out)
end

local function badge(tag)
    local t = details.tags[tag]
    return "<color=" .. (BADGE[t and t.g] or BADGE.neutral) .. "><b>(" .. tag .. ")</b></color>"
end

-- (1CD)-style tags coloured: each "(" with a known tag of up to 6 letters, digits, "/" or "-" before its ")"
local function withBadges(text)
    local out, i = {}, 1
    while true do
        local open = text:find("(", i, true)
        if not open then table.insert(out, text:sub(i)) break end
        local close = text:find(")", open + 1, true)
        local tag = close and close - open <= 8 and tagCase[text:sub(open + 1, close - 1):upper()]
        if tag then
            table.insert(out, text:sub(i, open - 1)); table.insert(out, badge(tag)); i = close + 1
        else
            table.insert(out, text:sub(i, open)); i = open + 1
        end
    end
    return table.concat(out)
end

-- Arial (TTS's UI font) advance widths in font units (2048 em), ASCII 32..126, regular and bold; Unity draws each glyph
-- a whole number of pixels wide
local ARIAL_R = "569,569,727,1139,1139,1821,1366,391,682,682,797,1196,569,682,569,569,1139,1139,1139,1139,1139,1139,1139,1139,1139,1139,569,569,1196,1196,1196,1139,2079,1366,1366,1479,1479,1366,1251,1593,1479,569,1024,1366,1139,1706,1479,1593,1366,1593,1479,1366,1251,1479,1366,1933,1366,1366,1251,569,569,569,961,1139,682,1139,1139,1024,1139,1139,569,1139,1139,455,455,1024,455,1706,1139,1139,1139,1139,682,1024,569,1139,1024,1479,1024,1024,1024,684,532,684,1196"
local ARIAL_B = "569,682,971,1139,1139,1821,1479,487,682,682,797,1196,569,682,569,569,1139,1139,1139,1139,1139,1139,1139,1139,1139,1139,682,682,1196,1196,1196,1251,1997,1479,1479,1479,1479,1366,1251,1593,1479,569,1139,1479,1251,1706,1479,1593,1366,1593,1479,1366,1251,1479,1366,1933,1366,1366,1251,682,569,682,1196,1139,682,1139,1251,1139,1251,1139,682,1251,1251,569,569,1139,569,1821,1251,1251,1251,1251,797,1139,682,1251,1139,1593,1139,1139,1024,797,573,797,1196"
local ARIAL_MORE = {["★"] = 1671, ["·"] = 682, ["∞"] = 1460, ["™"] = 2048}
local function advances(list)
    local t, i, c = {}, 1, 32
    while i <= #list do
        local comma = list:find(",", i, true) or #list + 1
        t[string.char(c)] = tonumber(list:sub(i, comma - 1))
        i, c = comma + 1, c + 1
    end
    return t
end
local ADVANCE = {[false] = advances(ARIAL_R), [true] = advances(ARIAL_B)}
local function glyphW(ch, bold, f)
    local u = ADVANCE[bold == true][ch] or ARIAL_MORE[ch]
    if not u then
        local b = ch:byte() or 0
        u = (b >= 128 and b < 192) and 0 or 1139       -- a UTF-8 continuation byte (plain Lua), else a digit's width
    end
    return math.floor(u * f / 2048 + 0.5)
end

-- a hover's {label, rule}, one table per status, timing tag or type (the same one each time: a word's hovers compared)
local tipsOf, tipsFor = {}, nil
local function tipOf(kind, name)
    if tipsFor ~= details then tipsOf, tipsFor = {}, details end
    local key = kind .. name
    if not tipsOf[key] then
        if kind == "s" then tipsOf[key] = {name, details.statuses[name].x or ""}
        elseif kind == "g" then tipsOf[key] = {"(" .. name .. ")", details.tags[name].m or ""}
        else tipsOf[key] = {details.types[name].n or name, details.types[name].x or ""} end
    end
    return tipsOf[key]
end

-- creature and minion types' words as an ability prints their icons ([fire] -> fire, [offensive_minion] -> offensive
-- minion), {word, type}, longest first: lowercase only (abilities write them so only by their icons); item and status
-- types' words (attack, equip, buff) are everyday words there, left out
local TYPE_CHAPTERS = {["creature-types"] = true, ["minions"] = true}
local typeWords, typeWordsFor = {}, nil
local function typeWordList()
    if typeWordsFor ~= details then
        typeWords, typeWordsFor = {}, details
        for key, info in pairs(details.types or {}) do
            if TYPE_CHAPTERS[info.c] then
                local name = type(info.n) == "string" and info.n:lower() or key
                table.insert(typeWords, {key, key})
                if name ~= key then table.insert(typeWords, {name, key}) end
            end
        end
        table.sort(typeWords, function(a, b) return #a[1] > #b[1] or (#a[1] == #b[1] and a[1] < b[1]) end)
    end
    return typeWords
end

local function letter(ch) return (ch >= "a" and ch <= "z") or (ch >= "A" and ch <= "Z") end
local function typeInk(key) return hexColour((details.types[key] or {}).ic) end

-- t's type words, whole words, in order: {start, end, type}
local function typeSpans(t)
    local spans = {}
    for _, tw in ipairs(typeWordList()) do
        local from = 1
        while true do
            local s = t:find(tw[1], from, true)
            if not s then break end
            local e = s + #tw[1] - 1
            local free = not letter(t:sub(s - 1, s - 1)) and not letter(t:sub(e + 1, e + 1))
            for _, sp in ipairs(spans) do if free and s <= sp[2] and e >= sp[1] then free = false end end
            if free then table.insert(spans, {s, e, tw[2]}) end
            from = s + 1
        end
    end
    table.sort(spans, function(a, b) return a[1] < b[1] end)
    return spans
end

-- the ability as painted and withBadges draw it, in runs {text, colour, bold, tip, n}: a hover (a status word: a piece
-- naming a status, all of it; a timing tag; a type word, in its type's colour) its tip (tipOf) and occurrence n; and
-- whether it has one
local function abilityRuns(text, pieces)
    local runs, at, occ, spans = {}, 1, 0, typeSpans(text)
    local function hover(t, c, bold, tip)
        occ = occ + 1
        table.insert(runs, {t, c, bold, tip, occ})
    end
    local function add(t, c, st, base)                 -- t: text from base on
        if t == "" then return end
        local n
        if st then occ = occ + 1 n = occ end
        local function words(i, j)                     -- t's i..j (no tag): its type words apart (in a status word: none)
            for _, sp in ipairs(st and {} or spans) do
                local s, e = sp[1] - base + 1, sp[2] - base + 1
                if s >= i and e <= j then
                    if s > i then table.insert(runs, {t:sub(i, s - 1), c, false}) end
                    hover(t:sub(s, e), typeInk(sp[3]) or c, false, tipOf("t", sp[3]))
                    i = e + 1
                end
            end
            if i <= j then table.insert(runs, {t:sub(i, j), c, false, st, n}) end
        end
        local i, from = 1, 1
        while true do
            local open = t:find("(", from, true)
            if not open then break end
            local close = t:find(")", open + 1, true)
            local tag = close and close - open <= 8 and tagCase[t:sub(open + 1, close - 1):upper()]
            if tag then
                words(i, open - 1)
                local g, badge = details.tags[tag], "(" .. tag .. ")"
                local colour = BADGE[g and g.g] or BADGE.neutral
                if st then table.insert(runs, {badge, colour, true, st, n}) else hover(badge, colour, true, tipOf("g", tag)) end
                i, from = close + 1, close + 1
            else
                from = open + 1
            end
        end
        words(i, #t)
    end
    for _, p in ipairs(type(pieces) == "table" and pieces or {}) do
        local piece, c, s = type(p) == "table" and p[1], type(p) == "table" and hexColour(p[2]), nil
        if type(piece) == "string" and piece ~= "" and c then
            local from = at
            for _ = 1, math.max(1, math.floor(tonumber(p[3]) or 1)) do
                s = text:find(piece, from, true)
                if not s then break end
                from = s + 1
            end
        end
        if s then
            add(text:sub(at, s - 1), nil, nil, at)
            add(piece, c, details.statuses[piece] and tipOf("s", piece) or nil, s)
            at = s + #piece
        end
    end
    add(text:sub(at), nil, nil, at)
    return runs, occ > 0
end

-- the ability's lines as Unity wraps a Text w wide at size f (at spaces, greedy; a newline ends a line), each word's
-- width from ARIAL; per line its texts {text (rich), tips (its hovers)}: a hover occurrence's words one text (a word
-- with several, "(Softened/Thinned)", "(OS)/(BOGT)", one text with them all), the words between two of them one (with
-- their spaces: a line's texts joined by spaces are painted's text); the space between two texts is the row's spacing
local function abilityLines(runs, w, f)
    local lines, line, x, word, ww, gap = {}, {}, 0, {}, 0, nil
    local space = glyphW(" ", false, f)
    local function render(frags)                       -- {r, s, e} pieces of runs as rich text, one tag per style
        local out, i = {}, 1
        while i <= #frags do
            local r, parts, j = frags[i].r, {}, i
            while j <= #frags and frags[j].r[2] == r[2] and frags[j].r[3] == r[3] do
                table.insert(parts, frags[j].r[1]:sub(frags[j].s, frags[j].e))
                j = j + 1
            end
            local t = plain(table.concat(parts))
            if r[3] then t = "<b>" .. t .. "</b>" end
            table.insert(out, r[2] and "<color=" .. r[2] .. ">" .. t .. "</color>" or t)
            i = j
        end
        return table.concat(out)
    end
    local function endWord(nextGap)
        if #word > 0 then
            if #line > 0 and x + space + ww > w then table.insert(lines, line) line = {} end
            x = #line == 0 and ww or x + space + ww
            local n, tips = nil, {}
            for _, frag in ipairs(word) do
                n = n or frag.r[5]
                if frag.r[4] and frag.r[4] ~= tips[#tips] then table.insert(tips, frag.r[4]) end
            end
            local last = line[#line]
            if last and last.n == n then
                table.insert(last.frags, gap)
                for _, frag in ipairs(word) do table.insert(last.frags, frag) end
            else
                table.insert(line, {frags = word, n = n, tips = tips})
            end
            word, ww = {}, 0
        end
        gap = nextGap
    end
    for _, r in ipairs(runs) do
        local t = r[1]
        for i = 1, #t do
            local ch = t:sub(i, i)
            if ch == " " then
                endWord({r = r, s = i, e = i})
            elseif ch == "\n" then
                endWord(nil)
                table.insert(lines, line)
                line = {}
            else
                local frag = word[#word]
                if frag and frag.r == r and frag.e == i - 1 then frag.e = i else table.insert(word, {r = r, s = i, e = i}) end
                ww = ww + glyphW(ch, r[3], f)
            end
        end
    end
    endWord(nil)
    table.insert(lines, line)
    for _, l in ipairs(lines) do for _, el in ipairs(l) do el.text = render(el.frags) end end
    return lines
end

-- a text's hover: its rule; several: each "name: rule"
local function rulesOf(tips)
    if #tips == 1 then return tips[1][2] end
    local out = {}
    for _, tip in ipairs(tips) do table.insert(out, tip[1] .. ": " .. tip[2]) end
    return table.concat(out, "\n")
end

-- a hover's text in lines at most w wide at size f (at spaces; TTS's box takes its text's width, it wraps nothing)
local function tipText(text, w, f)
    local out, i, space = {}, 1, glyphW(" ", false, f)
    while i <= #text + 1 do
        local nl = text:find("\n", i, true) or #text + 1
        local line, x, j = {}, 0, i
        while j < nl do
            local sp = text:find(" ", j, true)
            if not sp or sp > nl then sp = nl end
            local word, ww = text:sub(j, sp - 1), 0
            for k = 1, #word do ww = ww + glyphW(word:sub(k, k), false, f) end
            if #line > 0 and x + space + ww > w then table.insert(out, table.concat(line, " ")) line, x = {}, 0 end
            x = #line == 0 and ww or x + space + ww
            table.insert(line, word)
            j = sp + 1
        end
        table.insert(out, table.concat(line, " "))
        i = nl + 1
    end
    return table.concat(out, "\n")
end

local function visibleLength(line)                     -- without <tags>
    local n, i = 0, 1
    while true do
        local lt = line:find("<", i, true)
        if not lt then return n + #line - i + 1 end
        local gt = line:find(">", lt + 1, true)
        n = n + lt - i
        if not gt then return n + #line - lt + 1 end
        i = gt + 1
    end
end

local function lines(text, perLine)
    local n, i = 0, 1
    while i <= #text + 1 do
        local nl = text:find("\n", i, true) or #text + 1
        n = n + math.max(1, math.ceil(visibleLength(text:sub(i, nl - 1)) / perLine))
        i = nl + 1
    end
    return n
end

-- the chapters a card's details point to: timing tags, its types', status effects
local function chaptersOf(card)
    local out, seen = {}, {}
    local function add(id) if id and not seen[id] and details.chapters[id] then seen[id] = true table.insert(out, id) end end
    if card.g then add("timing-tags") end
    for _, t in ipairs(card.t or {}) do add((details.types[t] or {}).c) end
    if card.x then add("status-effects") end
    for _, id in ipairs(card.r or {}) do add(id) end   -- damage types, negation, reactions named in its text
    return out
end

-- the cards a card's text names, to spawn: its status effects, then the others ({name, path})
local function namedOf(card)
    local out = {}
    for _, name in ipairs(card.x or {}) do
        local s = details.statuses[name]
        if s and s.p then table.insert(out, {name, s.p}) end
    end
    for _, path in ipairs(card.m or {}) do
        local c = details.cards[path]
        if c then table.insert(out, {c.n, path}) end
    end
    return out
end

-- the decks a card's text draws from, by card name (owner 2026-11-06; they replace the Specific Item Decks bag), one
-- button each: {label, {folder, stars, item type}, ...}, every card of tts.json in those folders at its count in the
-- save's piles (several: one merged deck); with an item type, every item with its icon instead (Cake Mix is a 2★
-- attack item too)
local function items(n) return {n .. "★ Items", {"Items/", n}} end
local function equips(n) return {n .. "★ Equips", {"Items/Equip/", n, "equip"}} end
local function attacks(n) return {n .. "★ Attack Items", {"Items/Attack/", n, "attack"}} end
local DECKS = {
    ["Butterfly"] = {{"5★ Creatures", {"Creatures/", 5}}},
    ["The Puppet"] = {items(1), items(2), items(3)},
    ["Gandhi"] = {attacks(4), attacks(2)},
    ["Tainted Isaac"] = {{"1-3★ Items", {"Items/", 1}, {"Items/", 2}, {"Items/", 3}}},
    ["Nuclear Proliferation"] = {attacks(2), attacks(3)},
    ["Tyler"] = {items(1), items(2), items(3)},
    ["Tainted Bethany"] = {{"3-4★ Items", {"Items/", 3}, {"Items/", 4}}},
    ["Binge Eater"] = {{"2★ Healing Items", {"Items/Heal/", 2, "food"}}},
    ["Eden's Soul"] = {items(3)},
    ["Mystery Gift"] = {items(1)},
    ["Tainted Eden"] = {equips(1), equips(2), equips(3), equips(4), items(1), items(2), items(3), items(4)},
    ["Tainted Lost"] = {items(2), items(3)},
    ["Tainted Cain"] = {items(1), items(2), items(3), items(4)},
}

-- whether an item has an item type's icon (a fragile equip is an equip)
local function typed(card, kind)
    for _, t in ipairs(card.t) do if t == kind or (kind == "equip" and t == "fragileequip") then return true end end
    return false
end

-- a deck's cards (paths): "Items/" + 2 is every Items/*/2 Stars/ card; with a type, every item with its icon (its
-- folder's when its icons weren't read)
local function deckPaths(deck)
    local out = {}
    for path, card in pairs(details.cards) do
        for i = 2, #deck do
            local folder, stars, kind = deck[i][1], deck[i][2], deck[i][3]
            local within = path:sub(1, #folder) == folder
            if kind and card.t then within = path:sub(1, 6) == "Items/" and typed(card, kind) end
            if within and path:find("/" .. stars .. " Stars/", 1, true) then
                table.insert(out, path)
                break
            end
        end
    end
    return out
end

-- the text before the ability (kind, stars, author; a constructed ban, dim too; the stats), and its lines as runs (abilityLines)
local function detailsText(card)
    local bits = {card.k}
    if card.st then table.insert(bits, math.floor(card.st) .. "★") end
    if card.by then table.insert(bits, "by " .. card.by) end
    local runs = {{table.concat(bits, " · ")}}
    if card.b then table.insert(runs, {"Banned in constructed" .. (type(card.b) == "string" and " (" .. card.b .. ")" or "")}) end
    local head = {}
    for _, r in ipairs(runs) do table.insert(head, "<color=" .. DIM .. ">" .. plain(r[1]) .. "</color>") end
    if card.s then
        table.insert(head, "<b>" .. plain(card.s) .. "</b>")
        table.insert(runs, {card.s, nil, true})
    end
    return table.concat(head, "\n"), runs
end

-- a button's width for its text at font size f (a little more than the text: never cut off)
local function widthOf(text, f) return math.floor(#text * (f + 2) * 0.55 + 22) end

-- text cut to fit width w at font size f, ending in "..." (never inside a UTF-8 character, no space before the dots)
local function shorten(text, w, f)
    local k = math.max(1, math.floor((w - 22) / ((f + 2) * 0.55)) - 3)
    while k > 1 and (text:byte(k + 1) or 0) >= 128 and (text:byte(k + 1) or 0) < 192 do k = k - 1 end
    while k > 1 and text:sub(k, k) == " " do k = k - 1 end
    return text:sub(1, k) .. "..."
end

-- a seat's panel k laid out at its size, for its card: the text's height measured, the Rules and spawn rows filled
local function layout(color, k)
    local open = (shown[color] or {})[k]
    if not open then return end
    local id, sz = color .. "_d" .. k, SIZES[open.size]
    local rules, named = chaptersOf(open.card), namedOf(open.card)
    local rowW, f = sz.w - 20, sz.f - 2
    -- list's buttons left to right on up to count rows, a new row when the next would pass the row's width; when they
    -- overflow the last row they are spread evenly over the rows instead; returns {i, text, w, row} per button and the
    -- rows used
    local function plan(list, n, count, label)
        local items, used, x = {}, 0, 0
        for i = 1, math.min(n, #list) do
            local text = label(list[i])
            items[i] = {i = i, text = text, w = widthOf(text, f)}
            if used == 0 or (x + 6 + items[i].w > rowW and used < count) then used, x = used + 1, items[i].w else x = x + 6 + items[i].w end
            items[i].row = used
        end
        if x > rowW and used > 1 then                  -- the last row overflows: evenly instead (row r still holds i >= r)
            local per = math.ceil(#items / used)
            for i, it in ipairs(items) do it.row = math.ceil(i / per) end
        end
        return items, used
    end
    -- the planned buttons into their rows; a row still too wide has its widest names shortened to one width that fits,
    -- ending in "...", the whole name on hover (11 of 772 cards' spawn buttons overflow one row at the default size),
    -- above the rows over it (above: rows over row 1): never over a button
    local function fill(rowsId, prefix, items, n, count, above)
        local byRow = {}
        for _, it in ipairs(items) do byRow[it.row] = byRow[it.row] or {} table.insert(byRow[it.row], it) end
        for r = 1, count do
            local items, cap, at = byRow[r] or {}, nil, {}
            local rest = rowW - 6 * (#items - 1)
            for _, it in ipairs(items) do rest = rest - it.w at[it.i] = it end
            if rest < 0 then                           -- the k widest at width cap, the rest as they are
                local ws = {}
                for j, it in ipairs(items) do ws[j] = it.w end
                table.sort(ws, function(a, b) return a > b end)
                for k = 1, #ws do
                    rest = rest + ws[k]
                    cap = math.floor(rest / k)
                    if k == #ws or cap >= ws[k + 1] then break end
                end
            end
            set(rowsId .. r, {active = #items > 0 and "true" or "false", width = rowW})
            for i = r, n do
                local it = at[i]
                if it then
                    local short = cap and it.w > cap
                    set(prefix .. r .. "_" .. i, {active = "true", text = plain(short and shorten(it.text, cap, f) or it.text),
                        tooltip = short and it.text or "", preferredWidth = short and cap or it.w, fontSize = f,
                        tooltipFontSize = sz.f, tooltipOffset = (above + r - 1) * (ROW_H + 8) + 8})
                else
                    set(prefix .. r .. "_" .. i, {active = "false"})
                end
            end
        end
    end
    local decks = DECKS[open.card.n] or {}
    local ruleItems, ruleRows = plan(rules, RULE_BUTTONS, RULE_ROWS, function(ch) return "Rules: " .. details.chapters[ch].title end)
    local cardItems, cardRows = plan(named, CARD_BUTTONS, CARD_ROWS, function(n) return "+ " .. n[1] end)
    local deckItems, deckRows = plan(decks, DECK_BUTTONS, DECK_ROWS, function(d) return "+ " .. d[1] end)
    fill(id .. "_rules", id .. "_r", ruleItems, RULE_BUTTONS, RULE_ROWS, 0)
    fill(id .. "_decks", id .. "_k", deckItems, DECK_BUTTONS, DECK_ROWS, ruleRows)
    fill(id .. "_cards", id .. "_c", cardItems, CARD_BUTTONS, CARD_ROWS, ruleRows + deckRows)
    open.rules, open.named, open.decks = rules, named, decks
    local foot = (ruleRows + deckRows + cardRows) * (ROW_H + 8) + 8
    for r = 1, CARD_ROWS do set(id .. "_cards" .. r, {offsetXY = "10 " .. (8 + (cardRows - r) * (ROW_H + 8))}) end
    for r = 1, DECK_ROWS do set(id .. "_decks" .. r, {offsetXY = "10 " .. (8 + (cardRows + deckRows - r) * (ROW_H + 8))}) end
    for r = 1, RULE_ROWS do set(id .. "_rules" .. r, {offsetXY = "10 " .. (8 + (cardRows + deckRows + ruleRows - r) * (ROW_H + 8))}) end
    local head, headRuns = detailsText(open.card)
    local textW, card = sz.w - 44, open.card
    local perLine, lineH = math.floor(textW / (sz.f * 0.52)), math.ceil(sz.f * 1.32)
    -- an ability with a hover: its lines in the pools (plain lines; rows, the widest to the lines with most texts), below
    -- the text before it, at Arial's line pitch; else (or when the pools are too few) all in one text
    local runs, hasTip = abilityRuns(card.a or "", card.ac)
    local laid = hasTip and abilityLines(runs, textW, sz.f)
    local rowOf, rowsN = {}, 0
    if laid then
        local plainN, rows = 0, {}
        for k, line in ipairs(laid) do
            if #line > 1 or (line[1] and #line[1].tips > 0) then table.insert(rows, k) else plainN = plainN + 1 end
        end
        table.sort(rows, function(a, b) return #laid[a] > #laid[b] or (#laid[a] == #laid[b] and a < b) end)
        for i, k in ipairs(rows) do rowOf[k] = i end
        rowsN = #rows
        if plainN > ABILITY_LINES or rowsN > #ROW_SLOTS then laid = nil end
    end
    local pageH
    if laid then
        local pitch = math.floor(sz.f * 1.15 + 0.5)
        local headN = 0
        for _, r in ipairs(headRuns) do headN = headN + #abilityLines({r}, textW, sz.f) end
        local y, al = 6 + (headN + 1) * pitch, 0
        for k, line in ipairs(laid) do
            local as = rowOf[k]
            if as then
                local row, slots = id .. "_as" .. as, ROW_SLOTS[as]
                set(row, {active = "true", offsetXY = "14 -" .. y, width = textW, height = pitch, spacing = glyphW(" ", false, sz.f)})
                for j = 1, slots do
                    local el = line[j]
                    if el and j == slots and line[j + 1] then          -- more than a row holds: the rest in its last text
                        local more = {}
                        for m = j, #line do table.insert(more, line[m].text) end
                        el = {text = table.concat(more, " "), tips = {}}
                    end
                    if el then
                        set(row .. "_" .. j, {active = "true", fontSize = sz.f, tooltip = #el.tips > 0 and tipText(rulesOf(el.tips), textW, sz.f) or "",
                            tooltipFontSize = sz.f})
                        setValue(row .. "_" .. j, el.text)
                    else
                        set(row .. "_" .. j, {active = "false"})
                    end
                end
            else
                al = al + 1
                set(id .. "_al" .. al, {active = "true", offsetXY = "14 -" .. y, width = textW, height = pitch, fontSize = sz.f})
                setValue(id .. "_al" .. al, line[1] and line[1].text or "")
            end
            y = y + pitch
        end
        for i = al + 1, ABILITY_LINES do set(id .. "_al" .. i, {active = "false"}) end
        for i = rowsN + 1, #ROW_SLOTS do set(id .. "_as" .. i, {active = "false"}) end
        set(id .. "_text", {width = textW, height = (headN + 1) * pitch, fontSize = sz.f})
        setValue(id .. "_text", head)
        pageH = y + 12
    else
        local text = head .. (card.a and "\n\n" .. withBadges(painted(card.a, card.ac)) or "")
        pageH = lines(text, perLine) * lineH + 12
        for i = 1, ABILITY_LINES do set(id .. "_al" .. i, {active = "false"}) end
        for i = 1, #ROW_SLOTS do set(id .. "_as" .. i, {active = "false"}) end
        set(id .. "_text", {width = textW, height = pageH, fontSize = sz.f})
        setValue(id .. "_text", text)
    end
    set(id .. "_head", {width = sz.w})
    set(id .. "_title", {width = sz.w - 140, fontSize = sz.f + 3})
    setValue(id .. "_title", plain(open.card.n or ""))
    set(id .. "_scroll", {width = sz.w - 8, height = sz.h - TITLE_H - 4 - foot})
    set(id .. "_page", {width = sz.w - 24, height = pageH})
    set(id, {width = sz.w, height = sz.h, active = "true"})
end

-- the panel a button is in: "<color>_d2_close" -> 2
local function panelOf(color, id)
    local rest = id:sub(#color + 3)
    local us = rest:find("_", 1, true)
    return tonumber(us and rest:sub(1, us - 1) or rest)
end

-- a name without case or punctuation ("Zess T. Deluxe" -> "zesstdeluxe")
local function bare(name)
    local out, low = {}, name:lower()
    for i = 1, #low do
        local b = low:byte(i)
        if b >= 128 or (b >= 48 and b <= 57) or (b >= 97 and b <= 122) then out[#out + 1] = low:sub(i, i) end
    end
    return table.concat(out)
end

-- a card by its name, else an alias (old names), indexed once; a name two cards share: the first path's
local named, namedFor = {}, nil
local function byName(name)
    if namedFor ~= details then
        named, namedFor = {}, details
        local paths = {}
        for path in pairs(details.cards) do table.insert(paths, path) end
        table.sort(paths)
        for pass = 1, 2 do
            for _, path in ipairs(paths) do
                local c = details.cards[path]
                for _, n in ipairs(pass == 1 and {c.n or ""} or c.al or {}) do
                    local k = bare(n)
                    if k ~= "" and not named[k] then named[k] = c end
                end
            end
        end
    end
    return named[bare(name or "")]
end

-- in the panel already showing this card, else a closed one, else the one opened longest ago
function showDetails(color, obj)
    ensureData()
    if not details then broadcastToColor("Card details are still loading.", color, {1, 0.6, 0.6}) return end
    local path = cardPath(obj, color)
    local card = path and (details.cards[path] or byName(obj.getName()))   -- renamed since this copy: by its name
    if not card then broadcastToColor("No details for this card.", color, {1, 0.6, 0.6}) return end
    ensurePanels(color, function()
        local mine = shown[color] or {}
        shown[color] = mine
        local k
        for i = 1, DETAILS_PANELS do if mine[i] and mine[i].card == card then k = i break end end
        if not k then for i = 1, DETAILS_PANELS do if not mine[i] then k = i break end end end
        if not k then
            k = 1
            for i = 2, DETAILS_PANELS do if mine[i].at < mine[k].at then k = i end end
        end
        opened = opened + 1
        mine[k] = {card = card, obj = obj, at = opened, size = mine[k] and mine[k].size or sizeOf[color] or 2}
        layout(color, k)
    end)
end

function closeDetails(player, _, id)
    local k = panelOf(player.color, id)
    if shown[player.color] then shown[player.color][k] = nil end
    set(player.color .. "_d" .. k, {active = "false"})
end

function detailsSize(player, _, id)                    -- this panel's size, and the size the next ones open at
    local color, k = player.color, panelOf(player.color, id)
    local open = (shown[color] or {})[k]
    if not open then return end
    open.size = math.max(1, math.min(#SIZES, open.size + (id:sub(-7) == "_bigger" and 1 or -1)))
    sizeOf[color] = open.size
    layout(color, k)
end

-- the rulebook PDF on the table, else taken out of the Rulebooks bag to where the player points
local function withRulebook(color, done)
    for _, o in ipairs(getObjects()) do
        if o.name == "Custom_PDF" and o.getName() == "Rulebook" then return done(o) end
    end
    for _, bag in ipairs(getObjects()) do
        if bag.type == "Bag" and bag.getName() == "Rulebooks" then
            for _, inside in ipairs(bag.getObjects()) do
                if inside.name == "Rulebook" then
                    local spot = Player[color].getPointerPosition() or bag.getPosition()
                    return bag.takeObject({guid = inside.guid, position = {spot.x, spot.y + 2, spot.z}, smooth = false,
                        callback_function = function(o) Wait.frames(function() done(o) end, 5) end})
                end
            end
        end
    end
    broadcastToColor("No rulebook found on the table or in the Rulebooks bag.", color, {1, 0.6, 0.6})
end

function openRules(player, _, id)
    local color = player.color
    local open, n = (shown[color] or {})[panelOf(color, id)], tonumber(id:sub(-1))   -- "<color>_d1_r1_2": the 2nd button (in row 1)
    local chapter = open and n and open.rules and details.chapters[open.rules[n]]
    if not chapter then return end
    local page = chapterPage[tonumber(chapter.num)] or pageOfTitle[chapter.title]
    if not page then broadcastToColor("The rulebook's pages aren't loaded yet.", color, {1, 0.6, 0.6}) return end
    withRulebook(color, function(book)
        book.Book.setPage(page)
        broadcastToColor("Rulebook: " .. chapter.title .. " (page " .. (page + 1) .. ")", color, {1, 1, 1})
    end)
end

-- the save's own cards by their pictures (a spawned copy keeps the team's description and all) and the size each is
-- played at (a card in a deck: the deck's), and per card back the size most of its cards have: read a few containers a
-- frame once the panels are built (indexLater), so the first spawn doesn't stall; a spawn before that ends finishes it
local scaleOfBack, indexQueue, tally = {}, nil, {}    -- tally: back -> "x y z" -> count
local copies = {}                                     -- path -> the most copies one saved deck holds
local INDEX_PER_FRAME = 3
local function scaleOf(t) t = t or {} return {t.scaleX or 1, t.scaleY or 1, t.scaleZ or 1} end
local cardTemplate, deckTemplate = nil, nil           -- a saved card's and deck's data: every field TTS expects
local function indexAdd(d, scale)                      -- d's path when d is a card
    local p, back
    if (d.Name == "Deck" or d.Name == "DeckCustom") and not deckTemplate then deckTemplate = d end
    if d.Name == "Card" or d.Name == "CardCustom" then
        cardTemplate = cardTemplate or d
        local deck = d.CustomDeck or {}
        local face = deck[tostring(math.floor((d.CardID or 0) / 100))]
        if not face then for _, v in pairs(deck) do face = v break end end
        p, back = face and pathOf(face.FaceURL), face and pathOf(face.BackURL)
        if p and not cardIndex[p] then cardIndex[p] = {data = d, scale = scale} end
        if back then
            local key = table.concat(scale, " ")
            tally[back] = tally[back] or {}
            local seen = tally[back][key] or {n = 0, scale = scale}
            seen.n = seen.n + 1
            tally[back][key] = seen
        end
    end
    local kids = d.Name == "Deck" or d.Name == "DeckCustom"   -- a deck's cards are drawn at the deck's size
    local held = {}
    for _, k in ipairs(d.ContainedObjects or {}) do
        local c = indexAdd(k, kids and scale or scaleOf(k.Transform))
        if kids and c then held[c] = (held[c] or 0) + 1 end
    end
    for c, n in pairs(held) do copies[c] = math.max(copies[c] or 0, n) end
    return p
end

-- reads up to n of the queued containers (nil: all); true once the index is whole
local function indexSome(n)
    if not indexQueue then                             -- the containers on the table, read later
        cardIndex, tally, indexQueue, copies = {}, {}, {}, {}
        for _, o in ipairs(getObjects()) do
            if o.type == "Deck" or o.type == "Bag" or o.type == "Infinite" or o.type == "Card" then table.insert(indexQueue, o) end
        end
    end
    while #indexQueue > 0 and (n == nil or n > 0) do
        local o = table.remove(indexQueue)
        if not o.isDestroyed() then
            local d = o.getData()
            indexAdd(d, scaleOf(d.Transform))
        end
        n = n and n - 1
    end
    if #indexQueue > 0 or indexQueue.done then return indexQueue.done end
    for back, sizes in pairs(tally) do
        local best = nil
        for _, seen in pairs(sizes) do if not best or seen.n > best.n then best = seen end end
        scaleOfBack[back] = best.scale
    end
    indexQueue.done = true
    return true
end

function indexLater()                                  -- a few containers a frame until the index is whole
    if not indexSome(INDEX_PER_FRAME) then Wait.frames(indexLater, 1) end
end

local function at0() return {posX = 0, posY = 0, posZ = 0, rotX = 0, rotY = 0, rotZ = 0, scaleX = 1, scaleY = 1, scaleZ = 1} end

-- a template's fields (its team fields blank), then these
local SKIP = {GUID = true, ContainedObjects = true, DeckIDs = true, CustomDeck = true, States = true, Tags = true, Memo = true}
local function like(template, fields)
    local out = {}
    for k, v in pairs(template or {}) do if not SKIP[k] then out[k] = v end end
    out.Description, out.GMNotes, out.LuaScript, out.LuaScriptState, out.XmlUI, out.Locked = "", "", "", "", "", false
    out.ColorDiffuse = out.ColorDiffuse or {r = 0.713235259, g = 0.713235259, b = 0.713235259}
    for k, v in pairs(fields) do out[k] = v end
    return out
end

local madeKey = 9000                                   -- the save's CustomDeck keys stay below (47-1727)
local function newKey()                                -- the next free key, of the type the save's keys have
    madeKey = madeKey + 1
    for k in pairs(cardTemplate and cardTemplate.CustomDeck or {}) do return type(k) == "number" and madeKey or tostring(madeKey) end
    return tostring(madeKey)
end

-- a card the save lacks, made from its picture and its kind's back
local function madeCard(path, card)
    local back = "MDW/Assets/cardback_item.png"
    for _, kb in ipairs(BACKS) do if (card.k or ""):find(kb[1], 1, true) == 1 then back = kb[2] end end
    local enc = function(p) return (p:gsub(" ", "%%20")) end
    local key = newKey()
    return like(cardTemplate, {Name = "CardCustom", Nickname = card.n, CardID = madeKey * 100, Transform = at0(),
        CustomDeck = {[key] = {FaceURL = RAW_MAIN .. enc(path), BackURL = RAW_MAIN .. enc(back), NumWidth = 1, NumHeight = 1,
            BackIsHidden = true, UniqueBack = false, Type = 0}}})
end

-- a card (its path) spawned: into the player's hand, face down on the way in (nobody else sees it), else at pos facing
-- spin (a player without a hand); a copy of the save's own when there is one, else made; at its played size
local function faceOf(data)                            -- a card's CustomDeck entry: under CardID / 100, else the first
    local cd, id = data.CustomDeck or {}, math.floor((data.CardID or 0) / 100)
    local face = cd[id] or cd[tostring(id)] or {}
    if not face.BackURL then for _, v in pairs(cd) do face = v break end end
    return face
end

local function spawnCard(path, name, pos, spin, color)
    local hand = color and Player[color] and Player[color].getHandTransform()
    if hand then
        pos = {hand.position.x, hand.position.y + 1, hand.position.z}
        spin = hand.rotation.y + 180
    end
    indexSome()                                        -- what the background read hasn't reached yet, now
    local known = cardIndex[path]
    local data = known and known.data or madeCard(path, details.cards[path] or {n = name})
    local face = faceOf(data)
    local scale = known and known.scale or scaleOfBack[pathOf(face.BackURL) or ""] or {1, 1, 1}
    data.GUID = nil
    spawnObjectData({data = data, position = pos, rotation = {0, spin or 0, hand and 180 or 0}, scale = scale,
        callback_function = function(o)
            if resizeTargets[o.getName()] then o.setScale(LARGE_CARD_SCALE) end
        end})
end

function spawnNamed(player, _, id)                     -- beside the card the panel is about, fanned out
    local color = player.color
    local open, n = (shown[color] or {})[panelOf(color, id)], tonumber(id:sub(-1))   -- "<color>_d1_c1_3": the 3rd card it names
    local item = open and n and open.named and open.named[n]
    if not item then return end
    local from = open.obj and not open.obj.isDestroyed() and open.obj
    local at = from and from.getPosition() or Player[color].getPointerPosition() or {x = 0, y = 1, z = 0}   -- a hand wins in spawnCard
    open.spawned = (open.spawned or 0) + 1
    spawnCard(item[2], item[1], {at.x + 2.6 * open.spawned, at.y + 1.5, at.z}, from and from.getRotation().y or 0, color)
end

-- a deck of these cards, each at its copies in the save's piles (else once), shuffled, face down at pos, named name:
-- the save's own cards (their CustomDeck keys are unique in the save) or made ones, in a saved deck's fields; its size
local function deckOf(list, name, pos, spin)
    indexSome()
    local paths = {}
    for _, path in ipairs(list) do for _ = 1, copies[path] or 1 do table.insert(paths, path) end end
    for i = #paths, 2, -1 do
        local j = math.random(i)
        paths[i], paths[j] = paths[j], paths[i]
    end
    local deck = like(deckTemplate, {Name = "Deck", Nickname = name, Transform = at0(), DeckIDs = {}, CustomDeck = {}, ContainedObjects = {}})
    local scale
    for _, path in ipairs(paths) do
        local known = cardIndex[path]
        local data = known and known.data or madeCard(path, details.cards[path])
        local card = {}
        for k, v in pairs(data) do card[k] = v end     -- a copy: the index keeps its own
        card.GUID, card.Transform = nil, at0()
        for k, v in pairs(card.CustomDeck or {}) do deck.CustomDeck[k] = v end
        table.insert(deck.DeckIDs, card.CardID)
        table.insert(deck.ContainedObjects, card)
        scale = scale or known and known.scale or scaleOfBack[pathOf(faceOf(card).BackURL) or ""]
    end
    spawnObjectData({data = deck, position = pos, rotation = {0, spin or 0, 180}, scale = scale or {1, 1, 1}})
    return #paths
end

-- pos moved toward the table's middle (z 0; the hand zones line the long sides) until it is clear of every hand zone:
-- a deck dropped in one is dealt into that hand
local HAND_MARGIN = 2
local function clearOfHands(pos)
    local zones = Hands.getHands() or {}
    local function inside(x, z)
        for _, h in ipairs(zones) do
            local p, s, r = h.getPosition(), h.getScale(), math.rad(h.getRotation().y)
            local dx, dz = x - p.x, z - p.z
            local lx, lz = dx * math.cos(r) - dz * math.sin(r), dx * math.sin(r) + dz * math.cos(r)
            if math.abs(lx) <= s.x / 2 + HAND_MARGIN and math.abs(lz) <= s.z / 2 + HAND_MARGIN then return true end
        end
        return false
    end
    local x, z, step = pos[1], pos[3], pos[3] > 0 and -0.5 or 0.5
    for _ = 1, 200 do
        if not inside(x, z) then break end
        z = z + step
    end
    return {x, pos[2], z}
end

function spawnDeck(player, _, id)                      -- beside the card, clear of the hand zones
    local color = player.color
    local open, n = (shown[color] or {})[panelOf(color, id)], tonumber(id:sub(-1))   -- "<color>_d1_k2_4": its 4th deck
    local deck = open and n and open.decks and open.decks[n]
    if not deck then return end
    local ok, err = pcall(function()
        local paths = deckPaths(deck)
        if #paths == 0 then broadcastToColor("No cards found for " .. deck[1] .. ".", color, {1, 0.6, 0.6}) return end
        local from = open.obj and not open.obj.isDestroyed() and open.obj
        local at = from and from.getPosition() or Player[color].getPointerPosition() or {x = 0, y = 1, z = 0}
        open.spawned = (open.spawned or 0) + 1
        local n = deckOf(paths, deck[1], clearOfHands({at.x + 2.6 * open.spawned, at.y + 2, at.z}), from and from.getRotation().y or 0)
        broadcastToColor(deck[1] .. ": " .. n .. " cards, shuffled.", color, {1, 1, 1})
    end)
    if not ok then
        log("Deck button: " .. tostring(err))
        broadcastToColor("Deck button failed: " .. tostring(err), color, {1, 0.6, 0.6})
    end
end

-- the rulebook panel: its chapters, or the pages holding every word searched (a snippet of each); a click turns the PDF there
local found = {}                                       -- color -> the pages its buttons go to
local function listPages(color, query)
    local id, list, chars = color .. "_rb", {}, {}
    for i = 1, #(query or "") do                       -- "(" and ")" count as spaces: "(1CD)" finds the drawn 1CD
        local ch = query:sub(i, i)
        chars[i] = (ch == "(" or ch == ")") and " " or ch
    end
    local q = table.concat(chars):lower()
    local words = {}
    local start = 1
    while start <= #q do                               -- the query's words (spaces between them)
        local sp = q:find(" ", start, true) or #q + 1
        if sp > start then table.insert(words, q:sub(start, sp - 1)) end
        start = sp + 1
    end
    for _, p in ipairs(bookPages) do
        if #words == 0 then
            if p.chapter then table.insert(list, {p.page, (p.num ~= "" and (p.num .. ".  ") or "") .. p.name .. "   p. " .. (p.page + 1)}) end
        else
            local at = nil
            for _, w in ipairs(words) do
                local hit = p.low:find(w, 1, true)
                if not hit then at = nil break end
                at = at or hit
            end
            if at then
                local from, to = math.max(1, at - 28), at + 44     -- the snippet on whole words
                local sp = from > 1 and p.text:find(" ", from, true)
                if sp and sp < at then from = sp + 1 end
                local stop = p.text:find(" ", to, true)
                local snippet = p.text:sub(from, stop and stop - 1 or #p.text)
                table.insert(list, {p.page, "p. " .. (p.page + 1) .. "  " .. p.name .. ":  " .. (from > 1 and "..." or "") .. snippet .. (stop and "..." or "")})
            end
        end
        if #list >= RESULTS then break end
    end
    found[color] = list
    for i = 1, RESULTS do
        local item = list[i]
        set(id .. "_g" .. i, item and {active = "true", text = item[2]} or {active = "false"})
    end
    set(id .. "_list", {height = math.max(40, #list * 33 + 10)})
    setValue(id .. "_title", #words == 0 and "Rulebook: contents" or (#list == 0 and "Nothing found" or ("Rulebook: " .. #list .. (#list >= RESULTS and "+" or "") .. (#list == 1 and " page" or " pages"))))
end

function openRulebook(color)
    ensureData()
    if #bookPages == 0 then broadcastToColor("The rulebook's pages are still loading.", color, {1, 0.6, 0.6}) return end
    ensurePanels(color, function()
        rbOpen[color] = ""
        listPages(color, "")
        UI.setAttribute(color .. "_rb_q", "text", "")
        set(color .. "_rb", {active = "true"})
    end)
end

function closeRulebook(player)
    rbOpen[player.color] = nil
    set(player.color .. "_rb", {active = "false"})
end

function rulebookSearch(player, value)
    rbOpen[player.color] = value or ""
    listPages(player.color, value)
end

-- the card finder: every word must be in a card's name, kind, types (or their keys: "food"), timing tags, aliases or "banned" (a plural: or
-- its singular; a word without punctuation: or there with punctuation dropped, "moms"), or start a word of its series
-- ("undertale"); a digit 1-9 or "5★" (a "star(s)" after it dropped) is the card's stars; the typed name itself first
-- (punctuation aside), then names that start with it, then with its first word; a click spawns the card where the table was
-- right-clicked (several: side by side)
local fcOpen, fcFound, searchList = {}, {}, nil
local function listCards(color, query)
    if not searchList then                             -- each card's words, once, in name order (no sort per keystroke)
        searchList = {}
        local seen = {}                                -- a series' words, once: " don t starve dont starve don't starve"
        for path, c in pairs(details.cards) do
            local bits = {c.n or "", c.k or "", c.st and (math.floor(c.st) .. "★ " .. math.floor(c.st) .. " star") or ""}
            if c.k == "Buff" or c.k == "Debuff" then table.insert(bits, "status effect") end   -- the website's kind name
            if c.b then table.insert(bits, "banned") end   -- as the website's has:banned
            for _, t in ipairs(c.t or {}) do table.insert(bits, ((details.types[t] or {}).n or "") .. " " .. t) end
            for _, g in ipairs(c.g or {}) do table.insert(bits, "(" .. g .. ")") end
            for _, a in ipairs(c.al or {}) do table.insert(bits, a) end      -- the website's aliases ("Sans" for snas.)
            local se, all, name = c.se or 0, table.concat(bits, " "):lower(), (c.n or ""):lower()
            if not seen[se] then
                local s = ((details.series or {})[se] or ""):lower()
                local sp, sq = unpunct(s, " ", true), unpunct(s, "", true)
                seen[se] = " " .. sp .. (sq ~= sp and " " .. sq .. " " .. s or "")
            end
            table.insert(searchList, {path = path, name = name, all = all, flat = unpunct(all, "", true), flatName = unpunct(name, ""),
                series = seen[se], st = c.st and math.floor(c.st)})
        end
        table.sort(searchList, function(a, b) return a.name < b.name end)
    end
    local id, q, words = color .. "_fc", (query or ""):lower(), {}
    local start = 1
    while start <= #q do
        local sp = q:find(" ", start, true) or #q + 1
        if sp > start then table.insert(words, q:sub(start, sp - 1)) end
        start = sp + 1
    end
    local stars                                        -- "2", "2★", "2 stars": the card's stars, not every "2" ("(1/2CD)")
    for i = #words, 1, -1 do
        local wd = words[i]
        local n = (#wd == 1 or wd:sub(2) == "★") and tonumber(wd:sub(1, 1))
        if n and n > 0 then
            stars = (not stars or stars == n) and n or 0
            if words[i + 1] == "star" or words[i + 1] == "stars" then table.remove(words, i + 1) end
            table.remove(words, i)
        end
    end
    local tiers, one, bare, lead, leadOne = {{}, {}, {}, {}}, {}, {}, {}, {}
    for i, word in ipairs(words) do
        one[i] = #word > 4 and word:sub(-1) == "s" and word:sub(1, -2)    -- "5 stars", "creatures": the singular too
        local letters = unpunct(word, "")
        bare[i] = letters == word                              -- "moms": the card's text without punctuation too; "(os)": not
        lead[i] = letters == "" and word or " " .. unpunct(word, " ")   -- a series word's start (" don t"); "&", "//": as typed
        leadOne[i] = one[i] and " " .. unpunct(one[i], " ")
    end
    local whole = unpunct(table.concat(words), "")
    if #words > 0 or stars then
        for _, w in ipairs(searchList) do
            local ok = not stars or w.st == stars
            for i, word in ipairs(ok and words or {}) do
                local hit = w.all:find(word, 1, true) or one[i] and w.all:find(one[i], 1, true)
                    or bare[i] and w.flat:find(word, 1, true) or w.series:find(lead[i], 1, true)
                    or leadOne[i] and w.series:find(leadOne[i], 1, true)
                if not hit then ok = false break end
            end
            if ok then
                local tier = 4
                if whole ~= "" and w.flatName == whole then tier = 1
                elseif whole ~= "" and w.flatName:find(whole, 1, true) == 1 then tier = 2
                elseif words[1] and w.name:find(words[1], 1, true) == 1 then tier = 3 end
                table.insert(tiers[tier], w.path)
            end
        end
    end
    local first = tiers[1]
    for t = 2, 4 do for _, p in ipairs(tiers[t]) do table.insert(first, p) end end
    fcFound[color] = first
    for i = 1, RESULTS do
        local path = first[i]
        local c = path and details.cards[path]
        set(id .. "_g" .. i, c and {active = "true", text = plain(c.n) .. "   " .. (c.k or "") .. (c.st and (" " .. math.floor(c.st) .. "★") or "")
            .. (c.b and " · Banned" or "")} or {active = "false"})
    end
    set(id .. "_list", {height = math.max(40, math.min(#first, RESULTS) * 33 + 10)})
    setValue(id .. "_title", #words == 0 and not stars and "Find a card" or (#first == 0 and "No card found"
        or (#first .. (#first == 1 and " card" or " cards") .. (#first > RESULTS and (" (the first " .. RESULTS .. ")") or ""))))
end

function openFinder(color, at)
    ensureData()
    if not details then broadcastToColor("Card details are still loading.", color, {1, 0.6, 0.6}) return end
    ensurePanels(color, function()
        local was = fcOpen[color]
        fcOpen[color] = {query = was and was.query or "", at = at or (was and was.at), spawned = 0}
        listCards(color, fcOpen[color].query)
        UI.setAttribute(color .. "_fc_q", "text", fcOpen[color].query)
        set(color .. "_fc", {active = "true"})
    end)
end

function closeFinder(player)
    fcOpen[player.color] = nil
    set(player.color .. "_fc", {active = "false"})
end

function finderSearch(player, value)
    local f = fcOpen[player.color]
    if f then f.query = value or "" end
    listCards(player.color, value)
end

function finderGo(player, _, id)
    local color = player.color
    local f, n = fcOpen[color], tonumber(id:sub(#color + 6))   -- "<color>_fc_g7": the 7th card
    local path = f and n and (fcFound[color] or {})[n]
    if not path then return end
    local at = f.at or Player[color].getHandTransform().position
    local spin = (Player[color].getHandTransform() or {}).rotation
    spawnCard(path, details.cards[path].n, {at.x + 2.6 * f.spawned, at.y + 1.5, at.z}, spin and spin.y + 180 or 0, color)
    f.spawned = f.spawned + 1
end

-- a player's panels built if they aren't yet, then done(); after a build every panel open before it is drawn again
ensurePanels = function(colors, done)                  -- a color or a list of them
    done = done or function() end
    local new = false
    for _, c in ipairs(type(colors) == "table" and colors or {colors}) do
        if not built[c] then built[c], new = true, true end
    end
    if new then
        restoring = true
        rebuild()
    end
    if not restoring and not UI.loading then return done() end
    Wait.frames(function()
        Wait.condition(function()
            if restoring then
                restoring = false
                for c, mine in pairs(shown) do for k in pairs(mine) do layout(c, k) end end
                for c, q in pairs(rbOpen) do
                    listPages(c, q)
                    UI.setAttribute(c .. "_rb_q", "text", q)
                    set(c .. "_rb", {active = "true"})
                end
                for c, f in pairs(fcOpen) do
                    listCards(c, f.query)
                    UI.setAttribute(c .. "_fc_q", "text", f.query)
                    set(c .. "_fc", {active = "true"})
                end
            end
            done()
        end, function() return not UI.loading end, 10, function() log("Card details: the UI did not finish loading") end)
    end, 2)
end

function rulebookGo(player, _, id)
    local color = player.color
    local n = tonumber(id:sub(#color + 6))             -- "<color>_rb_g12": the 12th line
    local item = n and (found[color] or {})[n]
    if not item then return end
    withRulebook(color, function(book) book.Book.setPage(item[1]) end)
end

-- The turn markers: flipped by a player, they go green "Has not taken its turn" -> yellow "Is taking its turn" -> red
-- "Has taken its turn" (their name and tint say where they are; one event, no script on the markers)
local TURN_STATES = {{name = "Has not taken its turn", tint = {0, 1, 0}}, {name = "Is taking its turn", tint = {1, 1, 0}},
    {name = "Has taken its turn", tint = {1, 0, 0}}}

function onObjectRotate(obj, _, flip, _, _, oldFlip)
    if flip == oldFlip then return end
    local name = obj.getName()
    for i, state in ipairs(TURN_STATES) do
        if state.name == name then
            local nextState = TURN_STATES[i % #TURN_STATES + 1]
            obj.setColorTint(nextState.tint)
            obj.setName(nextState.name)
            return
        end
    end
end
