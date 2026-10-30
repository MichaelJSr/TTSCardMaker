-- Impossibility Simulator: seat teams, large cards resized out of containers.
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
end

function onObjectLeaveContainer(container, obj)
    if obj.type ~= "Card" or not resizeTargets[obj.getName()] then return end
    -- after the take has placed it
    Wait.frames(function()
        if not obj.isDestroyed() then obj.setScale(LARGE_CARD_SCALE) end
    end, 3)
end
