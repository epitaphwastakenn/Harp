--!nocheck

local Catalog = require(script.Parent.Parent.Catalog)
local State = require(script.Parent.Parent.State)
local Kit = require(script.Parent.Parent.Ui.Kit)

local colors = Kit.colors
local new = Kit.new

local Page = {}

function Page.create(frame: Frame)
	local top = new("Frame", { Name = "Top", BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 46), Parent = frame }, { Kit.pad(2, 16, 8, 16) })
	local search = new("Frame", { Name = "Search", BackgroundColor3 = colors.field, Size = UDim2.fromScale(1, 1), Parent = top }, { Kit.corner(9), Kit.stroke(0.9) })
	Kit.icon({ image = Kit.icons.search, size = 14, anchor = Vector2.new(0, 0.5), position = UDim2.new(0, 10, 0.5, 0), parent = search })
	local query = new("TextBox", { Name = "Query", BackgroundTransparency = 1, ClearTextOnFocus = false, Text = "", PlaceholderText = "Search tools", PlaceholderColor3 = colors.dim, TextColor3 = colors.text, FontFace = Kit.fonts.regular, TextSize = 14, TextXAlignment = Enum.TextXAlignment.Left, Position = UDim2.fromOffset(32, 0), Size = UDim2.new(1, -40, 1, 0), Parent = search })

	local listArea = new("Frame", { Name = "List", BackgroundTransparency = 1, Position = UDim2.fromOffset(0, 46), Size = UDim2.new(1, 0, 1, -46), Parent = frame })
	local scroller = Kit.scroller(listArea)
	local body = new("Frame", { Name = "Body", BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, Parent = scroller }, { Kit.pad(2, 16, 16, 16), Kit.list(8) })

	local collapsed = State.getSetting("collapsedGroups")
	if type(collapsed) ~= "table" then
		collapsed = {}
		for _, group in Catalog do
			collapsed[group.id] = true
		end
	end

	local refresh

	local function setGroup(group, enabled: boolean)
		local disabled = table.clone(State.toggles.disabledTools or {})
		for _, tool in group.tools do
			disabled[tool[1]] = if enabled then nil else true
		end
		State.setToggle("disabledTools", disabled)
	end

	refresh = function()
		Kit.clear(body)
		local text = string.lower(query.Text)
		local disabled = State.toggles.disabledTools or {}
		local shown = 0
		for order, group in Catalog do
			local matches = {}
			for _, tool in group.tools do
				if text == "" or string.find(string.lower(tool[1] .. " " .. tool[2] .. " " .. group.title), text, 1, true) then
					table.insert(matches, tool)
				end
			end
			if #matches > 0 then
				shown += 1
				local on = 0
				for _, tool in group.tools do
					if not disabled[tool[1]] then
						on += 1
					end
				end
				local open = text ~= "" or collapsed[group.id] ~= true
				local card = Kit.card(body, order, group.id)
				local arrow = Kit.icon({ image = Kit.icons.expand, size = 12 })
				arrow.Rotation = if open then 0 else -90
				Kit.row({ title = group.title, hint = string.format("%d of %d on", on, #group.tools), lead = arrow, trailWidth = 46, trail = Kit.switch(on > 0, nil, function()
					setGroup(group, on == 0)
				end), parent = card, order = 0, onClick = function()
					collapsed[group.id] = open
					State.setSetting("collapsedGroups", collapsed)
					refresh()
				end })
				if open then
					for i, tool in matches do
						local name, title = tool[1], tool[2]
						local enabled = not disabled[name]
						Kit.row({ title = title, hint = name, titleColor = if enabled then colors.text else colors.dim, lead = Kit.check(enabled), indent = 20, divider = true, parent = card, order = i, onClick = function()
							State.setToolEnabled(name, not enabled)
						end })
					end
				end
			end
		end
		if shown == 0 then
			Kit.label({ text = "No tool matches “" .. query.Text .. "”.", size = 13, color = colors.muted, parent = body })
		end
	end

	query:GetPropertyChangedSignal("Text"):Connect(function()
		refresh()
	end)

	return { refresh = refresh, shown = refresh }
end

return Page
