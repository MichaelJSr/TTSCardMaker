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
-- effects it names. Hold the "Card details (hold)" key (Options > Game Keys; Left Alt also zooms) for everything.
-- Rules buttons open the rulebook PDF at the chapter. Each player sees only their own; "Card info" turns the strip
-- off. Data: the website's data/tts.json (fetched on load); pages: TTS/Rulebook/pages.json.
local DETAILS_URL = "https://michaeljsr.github.io/TTSCardMaker/data/tts.json"
local PAGES_URL = "https://raw.githubusercontent.com/MichaelJSr/TTSCardMaker/main/TTS/Rulebook/pages.json"
local RAW_PATH = "^https://raw%.githubusercontent%.com/[^/]+/[^/]+/[^/]+/(.+)$"
local SEATS = {"White", "Brown", "Red", "Orange", "Yellow", "Green", "Teal", "Blue", "Purple", "Pink", "Grey", "Black"}
local BADGE = {turn = "#60a5fa", any = "#a78bfa", forced = "#f87171", trigger = "#fbbf24", neutral = "#cbd5e1"}
local DIM = "#94a3b8"
local STRIP_W, DETAILS_W, FONT = 760, 480, 14
local RULE_BUTTONS = 4

local details, tagCase, chapterPage, pageOfTitle = nil, {}, {}, {}
local stripOff, pinned, holding, keyUsed, hideToken, rulesFor = {}, {}, {}, {}, {}, {}

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

local function panel(id, color, align, pivot, offset, width, extra)
    return {tag = "Panel", attributes = {id = id, visibility = color, active = false, rectAlignment = align, pivot = pivot,
        offsetXY = offset, width = width, height = 60, color = "#0b1220E6", raycastTarget = true,
        onMouseEnter = extra and "stripEnter" or nil, onMouseExit = extra and "stripExit" or nil},
        children = {
            {tag = "Text", attributes = {id = id .. "_text", rectAlignment = "UpperCenter", offsetXY = "0 -8", width = width - 20,
                height = 44, fontSize = FONT, color = "#f1f5f9", alignment = "UpperLeft", horizontalOverflow = "Wrap",
                verticalOverflow = "Truncate"}, value = ""},
            rulesRow(id)}}
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

function loadCardDetails()
    buildPanels()
    addHotkey("Card details (hold)", detailsKey, true)
    WebRequest.get(DETAILS_URL, function(r)
        local data = not r.is_error and decode(r.text)
        if not (data and data.cards) then log("Card details: not loaded (" .. tostring(r.error) .. ")") return end
        for tag in pairs(data.tags or {}) do tagCase[tag:upper()] = tag end
        details = data
    end)
    WebRequest.get(PAGES_URL, function(r)
        local book = not r.is_error and decode(r.text)
        for i, page in ipairs(book and book.pages or {}) do
            local num = tonumber((page.num or ""):match("^(%d+)$"))
            if num and chapterPage[num] == nil then chapterPage[num] = i - 1 end
            if page.name and pageOfTitle[page.name] == nil then pageOfTitle[page.name] = i - 1 end
        end
    end)
end

-- the card's PNG path in the card repo, or nil (not a card, or hidden from this player)
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
    local path = url and url:match(RAW_PATH)
    return path and (path:gsub("%%(%x%x)", function(h) return string.char(tonumber(h, 16)) end))
end

local function badge(tag)
    local t = details.tags[tag]
    return "<color=" .. (BADGE[t and t.g] or BADGE.neutral) .. "><b>(" .. tag .. ")</b></color>"
end

local function withBadges(text)
    return (text:gsub("%((%-?[%w/]+)%)", function(t)
        local tag = tagCase[t:upper()]
        return tag and badge(tag) or nil
    end))
end

local function lead(text, limit)
    local first = text:match("^[^\n]*")
    if #first <= limit then return first end
    return (first:sub(1, limit):match("^(.*)%s") or first:sub(1, limit)) .. "..."
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

local function lines(text, perLine)
    local n = 0
    for line in (text .. "\n"):gmatch("(.-)\n") do
        n = n + math.max(1, math.ceil(#line:gsub("<[^>]+>", "") / perLine))
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

local function stripText(card, color)
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
    if not keyUsed[color] then
        table.insert(out, "<color=" .. DIM .. "><i>Hold your Card details key for everything (Options > Game Keys; Left Alt also zooms)</i></color>")
    end
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
    if not details or holding[color] then return end
    local path = cardPath(obj, color)
    local card = path and details.cards[path]
    local text = card and not stripOff[color] and stripText(card, color)
    if text then
        hideToken[color] = nil
        show(color .. "_strip", color, text, STRIP_W, card)
    else
        hideLater(color)
    end
end

function detailsKey(color, obj, _, keyUp)
    keyUsed[color] = true
    if keyUp then
        holding[color] = nil
        hide(color .. "_details")
        return
    end
    local path = details and cardPath(obj, color)
    local card = path and details.cards[path]
    if not card then return end
    holding[color] = path
    hide(color .. "_strip")
    show(color .. "_details", color, detailsText(card), DETAILS_W, card)
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
    local chapter = details and details.chapters[(rulesFor[color] or {})[tonumber(id:match("_r(%d+)$"))]]
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
