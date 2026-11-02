--!nocheck

local Config = require(script.Parent.Parent.Config)
local State = require(script.Parent.Parent.State)
local Kit = require(script.Parent.Parent.Ui.Kit)

local colors = Kit.colors
local new = Kit.new

local Page = {}

local phaseTitles = {
	connected = "Connected to Harp",
	connecting = "Connecting…",
	retrying = "Waiting for Harp",
	refused = "Not linked",
	duplicate = "Linked in another window",
	idle = "Disconnected",
}

local function statusColor(phase: string): Color3
	if phase == "connected" then
		return colors.ok
	elseif phase == "connecting" or phase == "retrying" then
		return colors.warn
	elseif phase == "refused" or phase == "duplicate" then
		return colors.error
	end
	return colors.idle
end

function Page.create(frame: Frame, context)
	local actions = context.actions
	local scroller = Kit.scroller(frame)
	local body = new("Frame", { Name = "Body", BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, Parent = scroller }, { Kit.pad(2, 16, 16, 16), Kit.list(10) })

	local function refresh()
		Kit.clear(body)
		local phase = State.connection.phase
		local tint = statusColor(phase)

		local connection = Kit.card(body, 1, "Connection")
		local badge = new("Frame", { Name = "Badge", BackgroundColor3 = tint, BackgroundTransparency = 0.84, Size = UDim2.fromOffset(34, 34) }, { Kit.corner(10) })
		Kit.icon({ image = Kit.icons.studio, size = 18, color = tint, anchor = Vector2.new(0.5, 0.5), position = UDim2.fromScale(0.5, 0.5), parent = badge })
		local active = actions.isActive()
		local trail = Kit.button({ text = if active then "Disconnect" else "Connect", primary = not active, onClick = actions.toggleConnection })
		local hint = if phase == "connected" then string.format("Harp %s · port %s", tostring(State.server.build or "?"), string.match(Config.baseUrl, ":(%d+)$") or "?") else (State.connection.detail or "Harp is not answering yet.")
		local row = Kit.row({ title = phaseTitles[phase] or phase, hint = hint, lead = badge, trailWidth = 112, trail = trail, parent = connection, order = 1 })
		row:FindFirstChild("Body").Position = UDim2.fromOffset(46, 0)
		row:FindFirstChild("Body").Size = UDim2.new(1, -158, 0, 0)
		if phase ~= "connected" and active then
			Kit.row({ title = "Retry now", hint = "Skip the wait and try to reach Harp again.", divider = true, parent = connection, order = 2, onClick = actions.retryNow })
		end
		if State.server.pluginOutdated or State.server.pluginUpdated then
			Kit.row({ title = "Updating the plugin…", hint = "Harp has a newer plugin; it swaps in by itself.", titleColor = colors.warn, divider = true, parent = connection, order = 3 })
		end
		if State.notice then
			Kit.row({ title = State.notice, titleColor = colors.accentText, divider = true, parent = connection, order = 4 })
		end

		Kit.caption("Place", body, 2)
		local place = Kit.card(body, 3, "Place")
		local roles = {}
		for _, peer in State.peers do
			table.insert(roles, tostring(peer.role or peer.logicalId or "peer"))
		end
		local placeHint = tostring(State.instanceId or "not registered yet")
		if #roles > 0 then
			placeHint ..= " · " .. table.concat(roles, ", ")
		end
		Kit.row({ title = State.placeName or game.Name, hint = placeHint, parent = place, order = 1 })

		Kit.caption("Agent in this Studio", body, 4)
		local safety = Kit.card(body, 5, "Safety")
		local toggles = State.toggles
		local function toggleRow(order: number, key: string, title: string, hint: string, divider: boolean)
			Kit.row({ title = title, hint = hint, divider = divider, trailWidth = 46, trail = Kit.switch(toggles[key] == true, nil, function()
				State.setToggle(key, not toggles[key])
			end), parent = safety, order = order })
		end
		toggleRow(1, "paused", "Pause the agent", "Refuse every request until you resume.", false)
		toggleRow(2, "readOnly", "Read-only", "The agent can look but not change the place.", true)
		toggleRow(3, "allowLuau", "Allow running Luau", "execute_luau and runtime eval.", true)
		Kit.label({ text = "Enforced here in Studio, whatever the agent asks. Playtests are switched per thread in Harp's agent controls.", size = 12, color = colors.dim, parent = body, order = 6 })

		local footer = new("Frame", { Name = "Footer", BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 32), LayoutOrder = 7, Parent = body }, { Kit.list(8, true) })
		Kit.button({ text = "Diagnostics", parent = footer, order = 1, onClick = function()
			print("[Harp] Diagnostics\n" .. table.concat(State.transportLog, "\n"))
		end })
		Kit.label({ text = string.format("protocol %s", tostring(Config.protocol)), size = 12, color = colors.dim, wrap = false, automatic = Enum.AutomaticSize.X, udim = UDim2.fromOffset(0, 32), parent = footer, order = 2 })
	end

	return { refresh = refresh, shown = refresh }
end

return Page
