--!nocheck

local AssetService = game:GetService("AssetService")
local CoreGui = game:GetService("CoreGui")

local Base64 = require(script.Parent.Base64)
local Lifetime = require(script.Parent.Lifetime)
local State = require(script.Parent.State)
local Kit = require(script.Parent.Ui.Kit)
local Logo = require(script.Parent.Ui.Logo)

local colors = Kit.colors
local new = Kit.new

local Overlay = {}

local tabs = {
	{ id = "prompt", title = "Prompt", icon = Kit.icons.prompt, module = "Prompt" },
	{ id = "studio", title = "Studio", icon = Kit.icons.studio, module = "Studio" },
	{ id = "tools", title = "Tools", icon = Kit.icons.tools, module = "Tools" },
	{ id = "activity", title = "Activity", icon = Kit.icons.activity, module = "Activity" },
}

local openInfo = TweenInfo.new(0.22, Enum.EasingStyle.Back, Enum.EasingDirection.Out)
local closeInfo = TweenInfo.new(0.14, Enum.EasingStyle.Quad, Enum.EasingDirection.In)
local quick = TweenInfo.new(0.12, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)

local logoContent = nil
local function logo(size: number, parent: Instance?, order: number?)
	local image = new("ImageLabel", { Name = "Logo", BackgroundColor3 = colors.accent, BackgroundTransparency = 0, Size = UDim2.fromOffset(size, size), LayoutOrder = order or 0, Parent = parent }, { Kit.corner(math.floor(size * 0.28)) })
	if logoContent == nil then
		local ok, content = pcall(function()
			local editable = AssetService:CreateEditableImage({ Size = Vector2.new(Logo.size, Logo.size) })
			editable:WritePixelsBuffer(Vector2.zero, Vector2.new(Logo.size, Logo.size), Base64.decode(Logo.rgba))
			return Content.fromObject(editable)
		end)
		logoContent = if ok then content else false
	end
	if logoContent then
		image.ImageContent = logoContent
		image.BackgroundTransparency = 1
	end
	return image
end
Overlay.logo = logo

function Overlay.status(): (Color3, string)
	local phase = State.connection.phase
	if phase == "connected" then
		if State.inFlight > 0 then
			return colors.accent, "Agent working"
		end
		return colors.ok, if State.server.agentLinked then "Connected" else "Connected · no agent yet"
	elseif phase == "connecting" then
		return colors.warn, "Connecting…"
	elseif phase == "retrying" then
		return colors.warn, "Waiting for Harp"
	elseif phase == "refused" or phase == "duplicate" then
		return colors.error, "Not linked"
	end
	return colors.idle, "Disconnected"
end

function Overlay.create(actions)
	local gui = new("ScreenGui", { Name = "HarpStudio", ResetOnSpawn = false, IgnoreGuiInset = true, ZIndexBehavior = Enum.ZIndexBehavior.Sibling, DisplayOrder = 50 })
	gui.Parent = CoreGui
	Lifetime.onStop(function()
		gui:Destroy()
	end)

	local launcher = new("TextButton", {
		Name = "Launcher",
		AutoButtonColor = false,
		Text = "",
		BackgroundColor3 = colors.panel,
		BackgroundTransparency = 0.04,
		AnchorPoint = Vector2.new(0, 1),
		Position = UDim2.new(0, 16, 1, -16),
		Size = UDim2.fromOffset(0, 40),
		AutomaticSize = Enum.AutomaticSize.X,
		Parent = gui,
	}, { Kit.round(), Kit.stroke(0.86), Kit.pad(5, 14, 5, 5), Kit.list(8, true) })
	local launcherScale = new("UIScale", { Parent = launcher })
	local launcherLogo = logo(30, launcher, 1)
	launcherLogo:FindFirstChildOfClass("UICorner").CornerRadius = UDim.new(1, 0)
	Kit.label({ text = "Harp", font = Kit.fonts.medium, size = 15, wrap = false, automatic = Enum.AutomaticSize.X, udim = UDim2.fromOffset(0, 30), parent = launcher, order = 2 })
	local launcherDot = Kit.dot(colors.idle, 8, launcher, 3)
	launcher.MouseEnter:Connect(function()
		Kit.tween(launcherScale, quick, { Scale = 1.04 })
	end)
	launcher.MouseLeave:Connect(function()
		Kit.tween(launcherScale, quick, { Scale = 1 })
	end)

	local panel = new("Frame", { Name = "Panel", Visible = false, BackgroundColor3 = colors.panel, AnchorPoint = Vector2.new(0, 1), Position = UDim2.new(0, 16, 1, -66), Size = UDim2.fromOffset(452, 500), Parent = gui }, { Kit.corner(14), Kit.stroke(0.86) })
	local panelScale = new("UIScale", { Parent = panel })
	new("TextButton", { Name = "Sink", Text = "", AutoButtonColor = false, BackgroundTransparency = 1, Size = UDim2.fromScale(1, 1), ZIndex = 0, Parent = panel })

	local rail = new("Frame", { Name = "Rail", BackgroundColor3 = colors.rail, Size = UDim2.new(0, 56, 1, 0), Parent = panel }, { Kit.corner(14) })
	new("Frame", { Name = "Patch", BackgroundColor3 = colors.rail, BorderSizePixel = 0, Position = UDim2.new(1, -14, 0, 0), Size = UDim2.new(0, 14, 1, 0), Parent = rail })
	new("Frame", { Name = "Divider", BackgroundColor3 = colors.line, BackgroundTransparency = 0.93, BorderSizePixel = 0, Position = UDim2.new(1, 0, 0, 0), Size = UDim2.new(0, 1, 1, 0), Parent = rail })
	local railList = new("Frame", { Name = "Tabs", BackgroundTransparency = 1, Size = UDim2.new(1, 0, 1, -56), Parent = rail }, { Kit.pad(12, 8, 0, 8), Kit.list(6) })
	railList:FindFirstChildOfClass("UIListLayout").HorizontalAlignment = Enum.HorizontalAlignment.Center
	logo(30, railList, 0)
	new("Frame", { Name = "Gap", BackgroundTransparency = 1, Size = UDim2.fromOffset(1, 6), LayoutOrder = 1, Parent = railList })

	local main = new("Frame", { Name = "Main", BackgroundTransparency = 1, Position = UDim2.fromOffset(57, 0), Size = UDim2.new(1, -57, 1, 0), Parent = panel })
	local header = new("Frame", { Name = "Header", BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 52), Parent = main }, { Kit.pad(0, 16, 0, 16) })
	local title = Kit.label({ name = "Title", text = "", font = Kit.fonts.bold, size = 17, wrap = false, udim = UDim2.new(1, -150, 1, 0), parent = header })
	local statusPill = new("Frame", { Name = "Status", BackgroundColor3 = colors.card, AnchorPoint = Vector2.new(1, 0.5), Position = UDim2.new(1, 0, 0.5, 0), Size = UDim2.fromOffset(0, 24), AutomaticSize = Enum.AutomaticSize.X, Parent = header }, { Kit.round(), Kit.pad(0, 10, 0, 9), Kit.list(6, true) })
	local statusDot = Kit.dot(colors.idle, 7, statusPill, 1)
	local statusText = Kit.label({ text = "", size = 12, color = colors.muted, wrap = false, automatic = Enum.AutomaticSize.X, udim = UDim2.fromOffset(0, 24), parent = statusPill, order = 2 })
	local pages = new("Frame", { Name = "Pages", BackgroundTransparency = 1, Position = UDim2.fromOffset(0, 52), Size = UDim2.new(1, 0, 1, -52), ClipsDescendants = true, Parent = main })

	local overlayContext = { panel = panel, actions = actions, logo = logo }
	local built = {}
	local buttons = {}
	local current = State.getSetting("tab")
	if type(current) ~= "string" then
		current = "prompt"
	end
	local isOpen = false

	local function page(id: string)
		if built[id] == nil then
			for _, tab in tabs do
				if tab.id == id then
					local frame = new("Frame", { Name = tab.module, BackgroundTransparency = 1, Size = UDim2.fromScale(1, 1), Visible = false, Parent = pages })
					built[id] = require(script.Parent.Pages[tab.module]).create(frame, overlayContext)
					built[id].frame = frame
				end
			end
		end
		return built[id]
	end

	local function paintRail()
		for id, entry in buttons do
			local active = id == current
			entry.button.BackgroundColor3 = colors.accent
			Kit.tween(entry.button, quick, { BackgroundTransparency = if active then 0.84 else 1 })
			entry.glyph.ImageColor3 = if active then colors.accentText else colors.muted
			entry.bar.Visible = active
		end
	end

	local function refreshChrome()
		local dotColor, line = Overlay.status()
		launcherDot.BackgroundColor3 = dotColor
		statusDot.BackgroundColor3 = dotColor
		statusText.Text = line
		for _, tab in tabs do
			if tab.id == current then
				title.Text = tab.title
			end
		end
	end

	local function refresh()
		if not Lifetime.alive then
			return
		end
		refreshChrome()
		if isOpen then
			local active = page(current)
			if active and active.refresh then
				active.refresh()
			end
		end
	end

	local function select(id: string)
		current = id
		State.setSetting("tab", id)
		for pageId, entry in built do
			entry.frame.Visible = pageId == id
		end
		local active = page(id)
		active.frame.Visible = true
		if active.shown then
			active.shown()
		end
		paintRail()
		refresh()
	end

	for i, tab in tabs do
		local button, glyph = Kit.iconButton({ name = tab.title, image = tab.icon, size = 40, iconSize = 20, radius = 10, order = i + 1, parent = railList, onClick = function()
			select(tab.id)
		end })
		button.BackgroundColor3 = colors.accent
		local bar = new("Frame", { Name = "Bar", BackgroundColor3 = colors.accent, BorderSizePixel = 0, AnchorPoint = Vector2.new(0, 0.5), Position = UDim2.new(0, -8, 0.5, 0), Size = UDim2.fromOffset(3, 20), Visible = false, Parent = button }, { Kit.round() })
		button.MouseLeave:Connect(paintRail)
		buttons[tab.id] = { button = button, glyph = glyph, bar = bar }
	end

	local closeButton = Kit.iconButton({ name = "Close", image = Kit.icons.close, size = 40, iconSize = 16, radius = 10, anchor = Vector2.new(0.5, 1), position = UDim2.new(0.5, 0, 1, -12), parent = rail })

	local function layout()
		local camera = workspace.CurrentCamera
		local viewport = if camera then camera.ViewportSize else Vector2.new(1280, 720)
		panel.Size = UDim2.fromOffset(math.clamp(viewport.X - 32, 300, 452), math.clamp(viewport.Y - 96, 320, 520))
	end

	local function open()
		if isOpen then
			return
		end
		isOpen = true
		layout()
		panelScale.Scale = 0.94
		panel.Position = UDim2.new(0, 16, 1, -56)
		panel.Visible = true
		Kit.tween(panelScale, openInfo, { Scale = 1 })
		Kit.tween(panel, openInfo, { Position = UDim2.new(0, 16, 1, -66) })
		select(current)
		if actions.onOpen then
			actions.onOpen()
		end
	end

	local closing = 0
	local function close()
		if not isOpen then
			return
		end
		isOpen = false
		closing += 1
		local mine = closing
		Kit.tween(panelScale, closeInfo, { Scale = 0.94 })
		Kit.tween(panel, closeInfo, { Position = UDim2.new(0, 16, 1, -56) }).Completed:Connect(function()
			if mine == closing and not isOpen then
				panel.Visible = false
			end
		end)
	end

	local function toggle()
		if isOpen then
			close()
		else
			open()
		end
	end

	launcher.Activated:Connect(toggle)
	closeButton.Activated:Connect(close)

	local function watchCamera()
		local camera = workspace.CurrentCamera
		if camera then
			Lifetime.connect(camera:GetPropertyChangedSignal("ViewportSize"), layout)
		end
		layout()
	end
	Lifetime.connect(workspace:GetPropertyChangedSignal("CurrentCamera"), watchCamera)
	watchCamera()

	local pending = false
	State.onChanged(function()
		if pending then
			return
		end
		pending = true
		task.delay(0.15, function()
			pending = false
			refresh()
		end)
	end)

	paintRail()
	refreshChrome()

	return { open = open, close = close, toggle = toggle, select = select, isOpen = function()
		return isOpen
	end }
end

return Overlay
