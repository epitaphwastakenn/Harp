--!nocheck

local StudioService = game:GetService("StudioService")

local Prompt = require(script.Parent.Parent.Prompt)
local State = require(script.Parent.Parent.State)
local Kit = require(script.Parent.Parent.Ui.Kit)

local colors = Kit.colors
local new = Kit.new

local Page = {}

local providerColors = {
	claudeAgent = Color3.fromRGB(217, 119, 87),
	claude = Color3.fromRGB(217, 119, 87),
	codex = Color3.fromRGB(16, 163, 127),
	cursor = Color3.fromRGB(200, 200, 210),
	opencode = Color3.fromRGB(240, 190, 60),
	grok = Color3.fromRGB(150, 150, 160),
	antigravity = Color3.fromRGB(90, 160, 255),
}

local stateLooks = {
	working = { colors.accent, "Working" },
	waiting = { colors.warn, "Waiting for you in Harp" },
	done = { colors.ok, "Done" },
	failed = { colors.error, "Stopped" },
	idle = { colors.idle, "Idle" },
}

local function providerColor(provider: string?): Color3
	if provider == nil then
		return colors.accent
	end
	for key, color in providerColors do
		if string.find(string.lower(provider), string.lower(key), 1, true) then
			return color
		end
	end
	return colors.accent
end

local function classIcon(className: string, parent: Instance)
	local image = Kit.icon({ image = "", size = 16, color = Color3.new(1, 1, 1), parent = parent, order = 1 })
	local ok, info = pcall(function()
		return StudioService:GetClassIcon(className)
	end)
	if ok and type(info) == "table" then
		image.Image = info.Image
		image.ImageRectOffset = info.ImageRectOffset or Vector2.zero
		image.ImageRectSize = info.ImageRectSize or Vector2.zero
	end
	return image
end

function Page.create(frame: Frame, context)
	local scroller = Kit.scroller(frame)
	local body = new("Frame", { Name = "Body", BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, Parent = scroller }, { Kit.pad(2, 16, 16, 16), Kit.list(10) })

	Kit.caption("Send to", body, 1)
	local select = new("TextButton", { Name = "Target", AutoButtonColor = false, Text = "", BackgroundColor3 = colors.field, Size = UDim2.new(1, 0, 0, 52), LayoutOrder = 2, Parent = body }, { Kit.corner(10), Kit.stroke(0.9), Kit.pad(0, 12, 0, 12) })
	Kit.hover(select, select, colors.field, colors.card)
	local providerDot = Kit.dot(colors.accent, 10, select)
	providerDot.AnchorPoint = Vector2.new(0, 0.5)
	providerDot.Position = UDim2.new(0, 0, 0.5, 0)
	local selectText = new("Frame", { Name = "Text", BackgroundTransparency = 1, Position = UDim2.fromOffset(20, 0), Size = UDim2.new(1, -44, 1, 0), Parent = select }, { Kit.list(1) })
	selectText:FindFirstChildOfClass("UIListLayout").VerticalAlignment = Enum.VerticalAlignment.Center
	local selectTitle = Kit.label({ text = "", font = Kit.fonts.medium, size = 14, wrap = false, height = 18, parent = selectText, order = 1 })
	local selectHint = Kit.label({ text = "", size = 12, color = colors.dim, wrap = false, height = 16, parent = selectText, order = 2 })
	Kit.icon({ image = Kit.icons.dropdown, size = 14, anchor = Vector2.new(1, 0.5), position = UDim2.new(1, 0, 0.5, 0), parent = select })

	local attachedCaption = Kit.caption("Attached", body, 3)
	local chips = new("Frame", { Name = "Chips", BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, LayoutOrder = 4, Parent = body }, { Kit.list(6, true, true) })

	local composer = new("Frame", { Name = "Composer", BackgroundColor3 = colors.field, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, LayoutOrder = 5, Parent = body }, { Kit.corner(12), Kit.stroke(0.86), Kit.pad(10, 10, 10, 12), Kit.list(8) })
	local input = new("TextBox", {
		Name = "Input",
		BackgroundTransparency = 1,
		ClearTextOnFocus = false,
		MultiLine = true,
		TextWrapped = true,
		TextXAlignment = Enum.TextXAlignment.Left,
		TextYAlignment = Enum.TextYAlignment.Top,
		FontFace = Kit.fonts.regular,
		TextSize = 15,
		TextColor3 = colors.text,
		PlaceholderColor3 = colors.dim,
		PlaceholderText = "Describe what to build or change in this place",
		Text = "",
		Size = UDim2.new(1, 0, 0, 84),
		LayoutOrder = 1,
		Parent = composer,
	})
	local footer = new("Frame", { Name = "Footer", BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 34), LayoutOrder = 2, Parent = composer })
	local footnote = Kit.label({ text = "", size = 12, color = colors.dim, udim = UDim2.new(1, -46, 1, 0), parent = footer })
	local sendButton = new("ImageButton", { Name = "Send", AutoButtonColor = false, BackgroundColor3 = colors.switchOff, AnchorPoint = Vector2.new(1, 0.5), Position = UDim2.new(1, 0, 0.5, 0), Size = UDim2.fromOffset(34, 34), Parent = footer }, { Kit.round() })
	local sendScale = new("UIScale", { Parent = sendButton })
	Kit.icon({ image = Kit.icons.send, size = 16, color = Color3.new(1, 1, 1), anchor = Vector2.new(0.5, 0.5), position = UDim2.fromScale(0.5, 0.5), parent = sendButton })

	local statusCard = new("Frame", { Name = "Status", BackgroundColor3 = colors.card, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, LayoutOrder = 6, Visible = false, Parent = body }, { Kit.corner(10), Kit.stroke(), Kit.pad(10, 12, 12, 12), Kit.list(6) })

	local menu = nil
	local function closeMenu()
		if menu then
			menu:Destroy()
			menu = nil
		end
	end

	local function canSend(): boolean
		return State.connection.phase == "connected" and not Prompt.sending and string.match(input.Text, "%S") ~= nil and Prompt.choice ~= nil
	end

	local function paintSend()
		local ready = canSend()
		sendButton.BackgroundColor3 = if ready then colors.accent else colors.switchOff
		sendButton.AutoButtonColor = false
	end

	local function openMenu()
		closeMenu()
		Prompt.refreshTargets()
		local panel = context.panel
		local scrim = new("TextButton", { Name = "MenuScrim", Text = "", AutoButtonColor = false, BackgroundTransparency = 1, Size = UDim2.fromScale(1, 1), ZIndex = 20, Parent = panel })
		local origin = select.AbsolutePosition - panel.AbsolutePosition
		local list = new("ScrollingFrame", {
			Name = "Menu",
			BackgroundColor3 = colors.card,
			BorderSizePixel = 0,
			Position = UDim2.fromOffset(origin.X, origin.Y + select.AbsoluteSize.Y + 6),
			Size = UDim2.fromOffset(select.AbsoluteSize.X, 0),
			AutomaticSize = Enum.AutomaticSize.None,
			CanvasSize = UDim2.new(),
			AutomaticCanvasSize = Enum.AutomaticSize.Y,
			ScrollBarThickness = 4,
			ScrollBarImageColor3 = colors.dim,
			ZIndex = 21,
			Parent = scrim,
		}, { Kit.corner(10), Kit.stroke(0.84), Kit.pad(4), Kit.list(2) })
		local function item(order: number, titleText: string, hint: string?, dotColor: Color3?, chosen: boolean, onPick)
			local row = new("TextButton", { Name = "Item", AutoButtonColor = false, Text = "", BackgroundColor3 = colors.cardHover, BackgroundTransparency = if chosen then 0.4 else 1, Size = UDim2.new(1, 0, 0, if hint then 44 else 34), LayoutOrder = order, ZIndex = 22, Parent = list }, { Kit.corner(7), Kit.pad(0, 10, 0, 10) })
			row.MouseEnter:Connect(function()
				row.BackgroundTransparency = 0
			end)
			row.MouseLeave:Connect(function()
				row.BackgroundTransparency = if chosen then 0.4 else 1
			end)
			if dotColor then
				local dot = Kit.dot(dotColor, 8, row)
				dot.AnchorPoint = Vector2.new(0, 0.5)
				dot.Position = UDim2.new(0, 0, 0.5, 0)
				dot.ZIndex = 23
			else
				local plus = Kit.icon({ image = Kit.icons.add, size = 14, anchor = Vector2.new(0, 0.5), position = UDim2.new(0, -3, 0.5, 0), parent = row })
				plus.ZIndex = 23
			end
			local text = new("Frame", { BackgroundTransparency = 1, Position = UDim2.fromOffset(18, 0), Size = UDim2.new(1, -18, 1, 0), ZIndex = 22, Parent = row }, { Kit.list(0) })
			text:FindFirstChildOfClass("UIListLayout").VerticalAlignment = Enum.VerticalAlignment.Center
			Kit.label({ text = titleText, font = Kit.fonts.medium, size = 14, wrap = false, height = 18, parent = text, order = 1 }).ZIndex = 23
			if hint then
				Kit.label({ text = hint, size = 12, color = colors.dim, wrap = false, height = 15, parent = text, order = 2 }).ZIndex = 23
			end
			row.Activated:Connect(function()
				onPick()
				closeMenu()
			end)
		end
		local count = 0
		for i, target in Prompt.targets do
			count += 1
			local hint = string.format("%s · %s", if target.linked then "Linked to this place" else target.projectTitle, target.model)
			item(i, target.title, hint, providerColor(target.provider), Prompt.choice == target.threadId, function()
				Prompt.choose(target.threadId)
			end)
		end
		if Prompt.canCreate then
			item(100, "New thread", "Same project and model as the latest thread", nil, Prompt.choice == "new", function()
				Prompt.choose("new")
			end)
		end
		if count == 0 and not Prompt.canCreate then
			Kit.label({ text = if Prompt.targetsLoaded then (Prompt.targetsError or "No Roblox project threads yet. Start one in Harp.") else "Loading threads…", size = 13, color = colors.muted, parent = list }).ZIndex = 22
		end
		local rows = count + (if Prompt.canCreate then 1 else 0)
		local room = panel.AbsoluteSize.Y - origin.Y - select.AbsoluteSize.Y - 18
		list.Size = UDim2.fromOffset(select.AbsoluteSize.X, math.clamp(rows * 46 + 10, 44, math.max(room, 120)))
		scrim.Activated:Connect(closeMenu)
		menu = scrim
	end

	select.Activated:Connect(function()
		if menu then
			closeMenu()
		else
			openMenu()
		end
	end)

	local function send()
		if not canSend() then
			if Prompt.choice == nil then
				openMenu()
			end
			return
		end
		local text = input.Text
		Kit.tween(sendScale, TweenInfo.new(0.08), { Scale = 0.9 }).Completed:Connect(function()
			Kit.tween(sendScale, TweenInfo.new(0.12, Enum.EasingStyle.Back), { Scale = 1 })
		end)
		task.spawn(function()
			if Prompt.send(text) then
				input.Text = ""
			end
		end)
	end
	sendButton.Activated:Connect(send)
	input:GetPropertyChangedSignal("Text"):Connect(paintSend)

	local function chip(order: number, entry)
		local item = new("Frame", { Name = "Chip", BackgroundColor3 = colors.card, Size = UDim2.fromOffset(0, 28), AutomaticSize = Enum.AutomaticSize.X, LayoutOrder = order, Parent = chips }, { Kit.corner(8), Kit.stroke(), Kit.pad(0, 4, 0, 8), Kit.list(6, true) })
		classIcon(entry.className, item)
		local name = Kit.label({ text = entry.name, font = Kit.fonts.medium, size = 13, wrap = false, automatic = Enum.AutomaticSize.X, udim = UDim2.fromOffset(0, 28), parent = item, order = 2 })
		new("UISizeConstraint", { MaxSize = Vector2.new(150, 28), Parent = name })
		Kit.label({ text = entry.className, size = 12, color = colors.dim, wrap = false, automatic = Enum.AutomaticSize.X, udim = UDim2.fromOffset(0, 28), parent = item, order = 3 })
		Kit.iconButton({ name = "Remove", image = Kit.icons.close, size = 22, iconSize = 10, radius = 6, order = 4, parent = item, onClick = function()
			Prompt.detach(entry.instance)
		end })
	end

	local function actionChip(order: number, text: string, image: string, active: boolean, onClick)
		local item = new("TextButton", { Name = "Action", AutoButtonColor = false, Text = "", BackgroundColor3 = if active then colors.accent else colors.panel, BackgroundTransparency = if active then 0.8 else 0, Size = UDim2.fromOffset(0, 28), AutomaticSize = Enum.AutomaticSize.X, LayoutOrder = order, Parent = chips }, { Kit.corner(8), Kit.pad(0, 10, 0, 8), Kit.list(6, true) })
		Kit.stroke(if active then 0.3 else 0.8, if active then colors.accent else nil).Parent = item
		Kit.icon({ image = image, size = 14, color = if active then colors.accentText else colors.muted, parent = item, order = 1 })
		Kit.label({ text = text, size = 13, color = if active then colors.accentText else colors.muted, wrap = false, automatic = Enum.AutomaticSize.X, udim = UDim2.fromOffset(0, 28), parent = item, order = 2 })
		item.Activated:Connect(onClick)
	end

	local function paintStatus()
		local current = Prompt.current
		Kit.clear(statusCard)
		statusCard.Visible = current ~= nil
		if current == nil then
			return
		end
		local look = stateLooks[current.state] or stateLooks.working
		local head = new("Frame", { Name = "Head", BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 22), LayoutOrder = 1, Parent = statusCard }, { Kit.list(8, true) })
		Kit.dot(look[1], 8, head, 1)
		Kit.label({ text = look[2], font = Kit.fonts.medium, size = 14, wrap = false, automatic = Enum.AutomaticSize.X, udim = UDim2.fromOffset(0, 22), parent = head, order = 2 })
		local where = Kit.label({ text = "· " .. tostring(current.title), size = 13, color = colors.dim, wrap = false, udim = UDim2.new(1, -170, 0, 22), parent = head, order = 3 })
		where.TextTruncate = Enum.TextTruncate.AtEnd
		Kit.iconButton({ name = "Dismiss", image = Kit.icons.close, size = 22, iconSize = 10, radius = 6, anchor = Vector2.new(1, 0), position = UDim2.new(1, 4, 0, -2), parent = statusCard, onClick = Prompt.dismiss })
		local reply = current.error or current.reply
		if reply == nil and current.state == "working" then
			reply = if current.delivery == "queued" then "Queued behind the turn already running." else "Sent. The agent is on it; replies show up here and in Harp."
		end
		if reply then
			local replyLabel = Kit.label({ text = reply, size = 13, color = if current.error then colors.error else colors.muted, parent = statusCard, order = 2 })
			replyLabel.LineHeight = 1.15
		end
	end

	local function refresh()
		local titleText, hint = Prompt.choiceLabel()
		selectTitle.Text = titleText
		selectHint.Text = hint
		local target = Prompt.choiceTarget()
		providerDot.BackgroundColor3 = if Prompt.choice == "new" then colors.accentText elseif target then providerColor(target.provider) else colors.idle

		Kit.clear(chips)
		for i, entry in Prompt.attachments do
			if entry.instance.Parent ~= nil then
				chip(i, entry)
			end
		end
		actionChip(100, "Attach selection", Kit.icons.add, false, function()
			if not Prompt.attachSelection() then
				Prompt.setPicking(true)
			end
		end)
		actionChip(101, if Prompt.picking then "Click something in Studio…" else "Pick", Kit.icons.pick, Prompt.picking, function()
			Prompt.setPicking(not Prompt.picking)
		end)
		attachedCaption.Text = if #Prompt.attachments > 0 then string.format("ATTACHED · %d", #Prompt.attachments) else "ATTACHED"

		if Prompt.sendError then
			footnote.Text = Prompt.sendError
			footnote.TextColor3 = colors.error
		elseif State.connection.phase ~= "connected" then
			footnote.Text = "Not linked to Harp. See the Studio tab."
			footnote.TextColor3 = colors.warn
		elseif Prompt.sending then
			footnote.Text = "Sending…"
			footnote.TextColor3 = colors.muted
		else
			footnote.Text = if #Prompt.attachments > 0 then "Attached items go along as context." else "Attach anything from the Explorer or viewport."
			footnote.TextColor3 = colors.dim
		end
		paintSend()
		paintStatus()
	end

	local loadedOnce = false
	local function shown()
		if not loadedOnce or not Prompt.targetsLoaded then
			loadedOnce = true
			Prompt.refreshTargets()
		end
		refresh()
	end

	return { refresh = refresh, shown = shown }
end

return Page
