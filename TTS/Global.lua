-- Impossibility Simulator: seat teams, large cards resized out of containers, card details on hover.
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

function onPlayerChangeColor(color)
    if color == "Grey" or color == "Black" then return end
    local player = Player[color]
    if not player or not player.seated then return end
    local team = TEAMS[color]
    player.team = team or "None"
    if team then
        broadcastToAll(player.steam_name .. " joined " .. color .. " → assigned to " .. team .. ".", {r=1, g=1, b=1})
    end
end

function onLoad()
    -- players already seated, once the load settles
    Wait.time(function()
        for _, color in ipairs(getSeatedPlayers()) do
            onPlayerChangeColor(color)
        end
    end, 1)
    loadCardDetails()
end

function onObjectLeaveContainer(container, obj)
    if obj.type ~= "Card" or not resizeTargets[obj.getName()] then return end
    -- after the take has placed it
    Wait.frames(function()
        if not obj.isDestroyed() then obj.setScale(LARGE_CARD_SCALE) end
    end, 3)
end

-- Card details. Hover a card: a strip at the bottom of your screen explains its timing tags, types and the status
-- effects it names. Right-click a card > Card details: everything about it, in a panel with Rules buttons that open the
-- rulebook PDF at the chapter. Each player sees only their own; "Card info" turns the strip off. Data: the website's
-- data/tts.json and TTS/Rulebook/pages.json, fetched a moment after the save loads. No Lua patterns over long text
-- (MoonSharp's are limited): plain finds only.
local DETAILS_URL = "https://michaeljsr.github.io/TTSCardMaker/data/tts.json"
local PAGES_URL = "https://raw.githubusercontent.com/MichaelJSr/TTSCardMaker/main/TTS/Rulebook/pages.json"
local RAW_PREFIX = "https://raw.githubusercontent.com/"
local SEATS = {"White", "Brown", "Red", "Orange", "Yellow", "Green", "Teal", "Blue", "Purple", "Pink", "Grey", "Black"}
local BADGE = {turn = "#60a5fa", any = "#a78bfa", forced = "#f87171", trigger = "#fbbf24", neutral = "#cbd5e1"}
local DIM = "#94a3b8"
local STRIP_W, DETAILS_W, FONT = 760, 480, 14
local RULE_BUTTONS = 4

local details, tagCase, chapterPage, pageOfTitle = nil, {}, {}, {}
local stripOff, pinned, open, hideToken, rulesFor, menued = {}, {}, {}, {}, {}, setmetatable({}, {__mode = "k"})

local function decode(text)
    local ok, data = pcall(JSON.decode, text or "")
    return ok and type(data) == "table" and data or nil
end

local function rulesRow(prefix)
    local row = {tag = "HorizontalLayout", attributes = {id = prefix .. "_rules", rectAlignment = "LowerCenter", offsetXY = "0 8",
        height = 28, spacing = 6, childForceExpandWidth = false, childAlignment = "MiddleLeft"}, children = {}}
    for i = 1, RULE_BUTTONS do
        table.insert(row.children, {tag = "Button", attributes = {id = prefix .. "_r" .. i, onClick = "openRules",
            preferredWidth = 150, fontSize = 13, active = false}, value = "Rules"})
    end
    return row
end

local function panel(id, color, align, pivot, offset, width, strip)
    local kids = {
        {tag = "Text", attributes = {id = id .. "_text", rectAlignment = "UpperCenter", offsetXY = "0 -8", width = width - 20,
            height = 44, fontSize = FONT, color = "#f1f5f9", alignment = "UpperLeft", horizontalOverflow = "Wrap",
            verticalOverflow = "Truncate"}, value = ""},
        rulesRow(id)}
    if not strip then                                  -- the details panel closes with its button
        table.insert(kids, {tag = "Button", attributes = {id = id .. "_close", rectAlignment = "UpperRight", offsetXY = "-6 -6",
            width = 26, height = 26, fontSize = 14, onClick = "closeDetails"}, value = "X"})
    end
    return {tag = "Panel", attributes = {id = id, visibility = color, active = false, rectAlignment = align, pivot = pivot,
        offsetXY = offset, width = width, height = 60, color = "#0b1220E6", raycastTarget = true,
        onMouseEnter = strip and "stripEnter" or nil, onMouseExit = strip and "stripExit" or nil}, children = kids}
end

local function buildPanels()
    local xml = UI.getXmlTable() or {}
    for _, c in ipairs(SEATS) do
        table.insert(xml, panel(c .. "_strip", c, "LowerCenter", "0.5 0", "0 80", STRIP_W, true))
        table.insert(xml, panel(c .. "_details", c, "MiddleLeft", "0 0.5", "20 0", DETAILS_W, false))
        table.insert(xml, {tag = "Button", attributes = {id = c .. "_toggle", visibility = c, rectAlignment = "LowerRight",
            offsetXY = "-10 10", width = 120, height = 26, fontSize = 13, onClick = "toggleStrip"}, value = "Card info: on"})
    end
    UI.setXmlTable(xml)
end

-- right-click > Card details on every card (loose ones at load, others as they come out of decks and bags)
local function addMenu(obj)
    if obj == nil or obj.type ~= "Card" or menued[obj] then return end
    menued[obj] = true
    obj.addContextMenuItem("Card details", function(color) showDetails(color, obj) end)
end

function loadCardDetails()
    Wait.time(function()                               -- a moment after the load: the save never waits on it
        buildPanels()
        for _, obj in ipairs(getObjects()) do addMenu(obj) end
        WebRequest.get(DETAILS_URL, function(r)
            local data = not r.is_error and decode(r.text)
            if not (data and data.cards) then log("Card details: not loaded (" .. tostring(r.error) .. ")") return end
            for tag in pairs(data.tags or {}) do tagCase[tag:upper()] = tag end
            details = data
        end)
        WebRequest.get(PAGES_URL, function(r)
            local book = not r.is_error and decode(r.text)
            for i, page in ipairs(book and book.pages or {}) do
                local num = tonumber(page.num)
                if num and num == math.floor(num) and chapterPage[num] == nil then chapterPage[num] = i - 1 end
                if page.name and pageOfTitle[page.name] == nil then pageOfTitle[page.name] = i - 1 end
            end
        end)
    end, 3)
end

function onObjectSpawn(obj) addMenu(obj) end

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

-- the card's PNG path in the card repo (raw.githubusercontent.com/owner/repo/ref/<path>), or nil (not a card, or
-- hidden from this player)
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
    if not url or url:sub(1, #RAW_PREFIX) ~= RAW_PREFIX then return nil end
    local at = #RAW_PREFIX + 1
    for _ = 1, 3 do                                    -- past the owner, the repo and the commit
        local slash = url:find("/", at, true)
        if not slash then return nil end
        at = slash + 1
    end
    return unescape(url:sub(at))
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

local function firstLine(text)
    local nl = text:find("\n", 1, true)
    return nl and text:sub(1, nl - 1) or text
end

local function lead(text, limit)                       -- the first line, cut at a space before limit
    local first = firstLine(text)
    if #first <= limit then return first end
    local cut = limit
    while cut > limit / 2 and first:byte(cut) ~= 32 do cut = cut - 1 end
    return first:sub(1, cut > limit / 2 and cut - 1 or limit) .. "..."
end

local function kindLine(card)
    local bits = {card.k}
    if card.st then table.insert(bits, math.floor(card.st) .. "★") end
    return table.concat(bits, " · ")
end

-- the chapters a card's details point to: timing tags, its types', status effects
local function chaptersOf(card)
    local out, seen = {}, {}
    local function add(id) if id and not seen[id] and details.chapters[id] then seen[id] = true table.insert(out, id) end end
    if card.g then add("timing-tags") end
    for _, t in ipairs(card.t or {}) do add((details.types[t] or {}).c) end
    if card.x then add("status-effects") end
    return out
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

local function show(id, color, text, width, card)
    local rules = chaptersOf(card)
    rulesFor[color] = rules
    for i = 1, RULE_BUTTONS do
        local chapter = rules[i] and details.chapters[rules[i]]
        UI.setAttribute(id .. "_r" .. i, "active", chapter and "true" or "false")
        if chapter then UI.setValue(id .. "_r" .. i, chapter.title) end
    end
    local textHeight = math.min(900, lines(text, math.floor((width - 20) / (FONT * 0.52))) * math.ceil(FONT * 1.3) + 4)
    UI.setValue(id .. "_text", text)
    UI.setAttribute(id .. "_text", "height", textHeight)
    UI.setAttribute(id, "height", textHeight + (#rules > 0 and 52 or 16))
    UI.setAttribute(id, "active", "true")
end

local function hide(id) UI.setAttribute(id, "active", "false") end

local function stripText(card)
    local out = {"<b>" .. card.n .. "</b>  <color=" .. DIM .. ">" .. kindLine(card) .. "</color>"}
    for _, tag in ipairs(card.g or {}) do table.insert(out, badge(tag) .. " " .. details.tags[tag].m) end
    for _, t in ipairs(card.t or {}) do
        local info = details.types[t]
        if info then table.insert(out, "<b>" .. info.n .. "</b>  " .. lead(info.x, 110)) end
    end
    for _, name in ipairs(card.x or {}) do
        local s = details.statuses[name]
        if s then table.insert(out, "<b>" .. name .. "</b>  " .. lead(withBadges(s.x), 110)) end
    end
    if #out == 1 then return nil end
    table.insert(out, "<color=" .. DIM .. "><i>Right-click the card > Card details for everything</i></color>")
    return table.concat(out, "\n")
end

local function detailsText(card)
    local out = {"<size=20><b>" .. card.n .. "</b></size>",
        "<color=" .. DIM .. ">" .. kindLine(card) .. (card.by and (" · by " .. card.by) or "") .. "</color>"}
    if card.s then table.insert(out, card.s) end
    if card.a then table.insert(out, "\n" .. withBadges(card.a)) end
    if card.g then
        table.insert(out, "\n<b>Timing tags</b>")
        for _, tag in ipairs(card.g) do table.insert(out, badge(tag) .. " " .. details.tags[tag].m) end
    end
    local typed = {}
    for _, t in ipairs(card.t or {}) do
        local info = details.types[t]
        if info then table.insert(typed, "<b>" .. info.n .. "</b>: " .. info.x) end
    end
    if #typed > 0 then table.insert(out, "\n<b>Types</b>\n" .. table.concat(typed, "\n")) end
    if card.x then
        table.insert(out, "\n<b>Status effects</b>")
        for _, name in ipairs(card.x) do
            local s = details.statuses[name]
            if s then table.insert(out, "<b>" .. name .. "</b> (" .. s.k .. "): " .. withBadges(s.x)) end
        end
    end
    return table.concat(out, "\n")
end

local function hideLater(color)
    local token = {}
    hideToken[color] = token
    Wait.time(function()
        if hideToken[color] == token and not pinned[color] then hide(color .. "_strip") end
    end, 0.8)
end

function onObjectHover(color, obj)
    if not details or open[color] then return end
    local path = cardPath(obj, color)
    local card = path and details.cards[path]
    local text = card and not stripOff[color] and stripText(card)
    if text then
        hideToken[color] = nil
        show(color .. "_strip", color, text, STRIP_W, card)
    else
        hideLater(color)
    end
end

function showDetails(color, obj)
    if not details then broadcastToColor("Card details are still loading.", color, {1, 0.6, 0.6}) return end
    local path = cardPath(obj, color)
    local card = path and details.cards[path]
    if not card then broadcastToColor("No details for this card.", color, {1, 0.6, 0.6}) return end
    open[color] = true
    hide(color .. "_strip")
    show(color .. "_details", color, detailsText(card), DETAILS_W, card)
end

function closeDetails(player)
    open[player.color] = nil
    hide(player.color .. "_details")
end

function stripEnter(player) pinned[player.color] = true end

function stripExit(player)
    pinned[player.color] = nil
    hideLater(player.color)
end

function toggleStrip(player)
    local color = player.color
    stripOff[color] = not stripOff[color] or nil
    UI.setValue(color .. "_toggle", stripOff[color] and "Card info: off" or "Card info: on")
    if stripOff[color] then hide(color .. "_strip") end
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
    local n = tonumber(id:sub(-1))                     -- "<color>_strip_r2": the 2nd button
    local chapter = details and n and details.chapters[(rulesFor[color] or {})[n]]
    if not chapter then return end
    local page = chapterPage[tonumber(chapter.num)] or pageOfTitle[chapter.title]
    if not page then
        broadcastToColor("The rulebook's pages aren't loaded yet.", color, {1, 0.6, 0.6})
        return
    end
    withRulebook(color, function(book)
        book.Book.setPage(page)
        broadcastToColor("Rulebook: " .. chapter.title .. " (page " .. (page + 1) .. ")", color, {1, 1, 1})
    end)
end
