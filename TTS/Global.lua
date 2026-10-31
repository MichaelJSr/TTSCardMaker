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
    ["Azamoth the Possessed Vessel"] = true,
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
-- (status effects and others) spawn beside the card with a click. Data: the website's data/tts.json and
-- TTS/Rulebook/pages.json, fetched a moment after the save loads; once tts.json is in, it is decoded and the seated
-- players' panels are built (a player seated later: a moment after sitting). No Lua patterns over long text (MoonSharp's
-- are limited): plain finds only.
local DETAILS_URL = "https://michaeljsr.github.io/TTSCardMaker/data/tts.json"
local PAGES_URL = "https://raw.githubusercontent.com/MichaelJSr/TTSCardMaker/main/TTS/Rulebook/pages.json"
local RAW_PREFIX = "https://raw.githubusercontent.com/"
local RAW_MAIN = "https://raw.githubusercontent.com/MichaelJSr/TTSCardMaker/main/"
local SEATS = {"White", "Brown", "Red", "Orange", "Yellow", "Green", "Teal", "Blue", "Purple", "Pink", "Grey", "Black"}
local BADGE = {turn = "#60a5fa", any = "#a78bfa", forced = "#f87171", trigger = "#fbbf24", neutral = "#cbd5e1"}
local DIM, HEAD = "#94a3b8", "#7dd3fc"
local SIZES = {{w = 440, h = 540, f = 14}, {w = 540, h = 660, f = 16}, {w = 660, h = 800, f = 18}}
local RULE_BUTTONS, CARD_BUTTONS, TITLE_H, ROW_H = 4, 6, 40, 30
local RULE_ROWS, CARD_ROWS = 2, 2                      -- rows the buttons may take (more than fit: names shortened)
local DETAILS_PANELS = 3                               -- a player's card details open at once (one more replaces the oldest)
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
        for i = r, n do table.insert(row.children, button(prefix .. r .. "_" .. i, "", onClick, {preferredWidth = 120, active = false, colors = colors or BUTTON})) end
        table.insert(out, row)
    end
    return out
end

-- one of a seat's details panels, k (its children placed by layout(), below); each a little further in than the last
local function detailsPanel(c, k)
    local id = c .. "_d" .. k
    local panel = {tag = "Panel", attributes = {id = id, visibility = c, active = false, allowDragging = true,
        returnToOriginalPositionWhenReleased = false, rectAlignment = "MiddleRight", offsetXY = (-60 - 50 * (k - 1)) .. " " .. (-40 * (k - 1)), width = 540, height = 660,
        color = "#0f1729F2", outline = "#3b4b6b", outlineSize = "2 -2"}, children = {
        {tag = "Panel", attributes = {id = id .. "_head", rectAlignment = "UpperCenter", height = TITLE_H, color = "#1b2740"}, children = {
            {tag = "Text", attributes = {id = id .. "_title", rectAlignment = "MiddleLeft", offsetXY = "12 0", height = TITLE_H,
                fontStyle = "Bold", color = "#ffffff", alignment = "MiddleLeft", horizontalOverflow = "Overflow"}, value = ""},
            button(id .. "_smaller", "A-", "detailsSize", {rectAlignment = "MiddleRight", offsetXY = "-84 0", width = 36, height = 28}),
            button(id .. "_bigger", "A+", "detailsSize", {rectAlignment = "MiddleRight", offsetXY = "-44 0", width = 36, height = 28}),
            button(id .. "_close", "X", "closeDetails", {rectAlignment = "MiddleRight", offsetXY = "-4 0", width = 36, height = 28})}},
        {tag = "VerticalScrollView", attributes = {id = id .. "_scroll", rectAlignment = "UpperCenter", offsetXY = "0 -" .. (TITLE_H + 4),
            color = "#00000000", scrollSensitivity = 30, horizontalScrollbarVisibility = "AutoHideAndExpandViewport",
            verticalScrollbarVisibility = "AutoHideAndExpandViewport"}, children = {
            {tag = "Panel", attributes = {id = id .. "_page", height = 100}, children = {
                {tag = "Text", attributes = {id = id .. "_text", rectAlignment = "UpperLeft", offsetXY = "14 -6", color = "#e8edf5",
                    alignment = "UpperLeft", horizontalOverflow = "Wrap", verticalOverflow = "Overflow"}, value = ""}}}}}}}
    for _, r in ipairs(rows(id .. "_rules", id .. "_r", RULE_BUTTONS, RULE_ROWS, "openRules")) do table.insert(panel.children, r) end
    for _, r in ipairs(rows(id .. "_cards", id .. "_c", CARD_BUTTONS, CARD_ROWS, "spawnNamed", SPAWN)) do table.insert(panel.children, r) end
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

-- the card's PNG path, or nil (not a card, or hidden from this player: face down or in another player's hand)
local function cardPath(obj, color)
    if obj == nil or obj.isDestroyed() or obj.type ~= "Card" or obj.is_face_down then return nil end
    for _, other in ipairs(getSeatedPlayers()) do
        if other ~= color then
            for _, o in ipairs(Player[other].getHandObjects() or {}) do
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

local function detailsText(card)
    local bits = {card.k}
    if card.st then table.insert(bits, math.floor(card.st) .. "★") end
    if card.by then table.insert(bits, "by " .. card.by) end
    local out = {"<color=" .. DIM .. ">" .. table.concat(bits, " · ") .. "</color>"}
    if card.s then table.insert(out, "<b>" .. card.s .. "</b>") end
    if card.a then table.insert(out, "\n" .. withBadges(card.a)) end
    local function section(title) table.insert(out, "\n<color=" .. HEAD .. "><b>" .. title .. "</b></color>") end
    if card.g then
        section("TIMING TAGS")
        for _, tag in ipairs(card.g) do table.insert(out, badge(tag) .. "  " .. details.tags[tag].m) end
    end
    local typed = {}
    for _, t in ipairs(card.t or {}) do
        local info = details.types[t]
        if info then table.insert(typed, "<b>" .. info.n .. "</b>  " .. info.x) end
    end
    if #typed > 0 then section("TYPES") for _, line in ipairs(typed) do table.insert(out, line) end end
    if card.x then
        section("STATUS EFFECTS")
        for _, name in ipairs(card.x) do
            local s = details.statuses[name]
            if s then table.insert(out, "<b>" .. name .. "</b> <color=" .. DIM .. ">(" .. s.k .. ")</color>  " .. withBadges(s.x)) end
        end
    end
    return table.concat(out, "\n")
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
    local rowW = sz.w - 20
    -- list's buttons left to right on up to count rows, a new row when the next would pass the row's width; when they
    -- overflow the last row they are spread evenly over the rows instead, and a row still too wide has its widest names
    -- shortened to one width that fits, ending in "...", the whole name on hover (11 of 772 cards' spawn buttons
    -- overflow one row at the default size); returns the rows used
    local function pack(rowsId, prefix, list, n, count, label)
        local f, items, byRow, used, x = sz.f - 2, {}, {}, 0, 0
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
                    set(prefix .. r .. "_" .. i, {active = "true", text = short and shorten(it.text, cap, f) or it.text,
                        tooltip = short and it.text or "", preferredWidth = short and cap or it.w, fontSize = f})
                else
                    set(prefix .. r .. "_" .. i, {active = "false"})
                end
            end
        end
        return used
    end
    local ruleRows = pack(id .. "_rules", id .. "_r", rules, RULE_BUTTONS, RULE_ROWS, function(ch) return "Rules: " .. details.chapters[ch].title end)
    local cardRows = pack(id .. "_cards", id .. "_c", named, CARD_BUTTONS, CARD_ROWS, function(n) return "+ " .. n[1] end)
    open.rules, open.named = rules, named
    local foot = (ruleRows + cardRows) * (ROW_H + 8) + 8
    for r = 1, CARD_ROWS do set(id .. "_cards" .. r, {offsetXY = "10 " .. (8 + (cardRows - r) * (ROW_H + 8))}) end
    for r = 1, RULE_ROWS do set(id .. "_rules" .. r, {offsetXY = "10 " .. (8 + (cardRows + ruleRows - r) * (ROW_H + 8))}) end
    local text = detailsText(open.card)
    local textW = sz.w - 44
    local textH = lines(text, math.floor(textW / (sz.f * 0.52))) * math.ceil(sz.f * 1.32) + 12
    set(id .. "_head", {width = sz.w})
    set(id .. "_title", {width = sz.w - 140, fontSize = sz.f + 3})
    setValue(id .. "_title", open.card.n)
    set(id .. "_scroll", {width = sz.w - 8, height = sz.h - TITLE_H - 4 - foot})
    set(id .. "_page", {width = sz.w - 24, height = textH})
    set(id .. "_text", {width = textW, height = textH, fontSize = sz.f})
    setValue(id .. "_text", text)
    set(id, {width = sz.w, height = sz.h, active = "true"})
end

-- the panel a button is in: "<color>_d2_close" -> 2
local function panelOf(color, id)
    local rest = id:sub(#color + 3)
    local us = rest:find("_", 1, true)
    return tonumber(us and rest:sub(1, us - 1) or rest)
end

-- in the panel already showing this card, else a closed one, else the one opened longest ago
function showDetails(color, obj)
    ensureData()
    if not details then broadcastToColor("Card details are still loading.", color, {1, 0.6, 0.6}) return end
    local path = cardPath(obj, color)
    local card = path and details.cards[path]
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
local INDEX_PER_FRAME = 3
local function scaleOf(t) t = t or {} return {t.scaleX or 1, t.scaleY or 1, t.scaleZ or 1} end
local function indexAdd(d, scale)
    if d.Name == "Card" or d.Name == "CardCustom" then
        local deck = d.CustomDeck or {}
        local face = deck[tostring(math.floor((d.CardID or 0) / 100))]
        if not face then for _, v in pairs(deck) do face = v break end end
        local p, back = face and pathOf(face.FaceURL), face and pathOf(face.BackURL)
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
    for _, k in ipairs(d.ContainedObjects or {}) do indexAdd(k, kids and scale or scaleOf(k.Transform)) end
end

-- reads up to n of the queued containers (nil: all); true once the index is whole
local function indexSome(n)
    if not indexQueue then                             -- the containers on the table, read later
        cardIndex, tally, indexQueue = {}, {}, {}
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

-- a card the save lacks, made from its picture and its kind's back
local function madeCard(path, card)
    local back = "MDW/Assets/cardback_item.png"
    for _, kb in ipairs(BACKS) do if (card.k or ""):find(kb[1], 1, true) == 1 then back = kb[2] end end
    local enc = function(p) return (p:gsub(" ", "%%20")) end
    return {Name = "CardCustom", Nickname = card.n, CardID = 100,
        Transform = {posX = 0, posY = 0, posZ = 0, rotX = 0, rotY = 0, rotZ = 0, scaleX = 1, scaleY = 1, scaleZ = 1},
        CustomDeck = {["1"] = {FaceURL = RAW_MAIN .. enc(path), BackURL = RAW_MAIN .. enc(back), NumWidth = 1, NumHeight = 1,
            BackIsHidden = true, UniqueBack = false, Type = 0}}}
end

-- a card (its path) spawned: into the player's hand, face down on the way in (nobody else sees it), else at pos facing
-- spin (a player without a hand); a copy of the save's own when there is one, else made; at its played size
local function spawnCard(path, name, pos, spin, color)
    local hand = color and Player[color] and Player[color].getHandTransform()
    if hand then
        pos = {hand.position.x, hand.position.y + 1, hand.position.z}
        spin = hand.rotation.y + 180
    end
    indexSome()                                        -- what the background read hasn't reached yet, now
    local known = cardIndex[path]
    local data = known and known.data or madeCard(path, details.cards[path] or {n = name})
    local face = data.CustomDeck and data.CustomDeck[tostring(math.floor((data.CardID or 0) / 100))] or {}
    if not face.BackURL then for _, v in pairs(data.CustomDeck or {}) do face = v break end end
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
    local at = from and from.getPosition() or Player[color].getHandTransform().position
    open.spawned = (open.spawned or 0) + 1
    spawnCard(item[2], item[1], {at.x + 2.6 * open.spawned, at.y + 1.5, at.z}, from and from.getRotation().y or 0, color)
end

-- the rulebook panel: its chapters, or the pages holding every word searched (a snippet of each); a click turns the PDF there
local found = {}                                       -- color -> the pages its buttons go to
local function listPages(color, query)
    local id, list, q = color .. "_rb", {}, (query or ""):lower()
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

-- the card finder: every word must be in a card's name, kind, stars ("5" or "5★"), types or timing tags; names that start with the search
-- come first; a click spawns the card where the table was right-clicked (several: side by side)
local fcOpen, fcFound, searchList = {}, {}, nil
local function listCards(color, query)
    if not searchList then                             -- each card's words, once, in name order (no sort per keystroke)
        searchList = {}
        for path, c in pairs(details.cards) do
            local bits = {c.n or "", c.k or "", c.st and (math.floor(c.st) .. "★ " .. math.floor(c.st) .. " star") or ""}
            for _, t in ipairs(c.t or {}) do table.insert(bits, (details.types[t] or {}).n or t) end
            for _, g in ipairs(c.g or {}) do table.insert(bits, "(" .. g .. ")") end
            table.insert(searchList, {path = path, name = (c.n or ""):lower(), all = table.concat(bits, " "):lower()})
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
    local first, rest = {}, {}
    if #words > 0 then
        for _, w in ipairs(searchList) do
            local ok = true
            for _, word in ipairs(words) do if not w.all:find(word, 1, true) then ok = false break end end
            if ok then table.insert(w.name:find(words[1], 1, true) == 1 and first or rest, w.path) end
        end
    end
    for _, p in ipairs(rest) do table.insert(first, p) end
    fcFound[color] = first
    for i = 1, RESULTS do
        local path = first[i]
        local c = path and details.cards[path]
        set(id .. "_g" .. i, c and {active = "true", text = c.n .. "   " .. (c.k or "") .. (c.st and (" " .. math.floor(c.st) .. "★") or "")}
            or {active = "false"})
    end
    set(id .. "_list", {height = math.max(40, math.min(#first, RESULTS) * 33 + 10)})
    setValue(id .. "_title", #words == 0 and "Find a card" or (#first == 0 and "No card found"
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
