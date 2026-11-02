--!nocheck

local TweenService = game:GetService("TweenService")

local Kit = {}

Kit.colors = {
	panel = Color3.fromRGB(27, 26, 33),
	rail = Color3.fromRGB(21, 20, 26),
	card = Color3.fromRGB(35, 34, 41),
	cardHover = Color3.fromRGB(42, 41, 49),
	field = Color3.fromRGB(20, 19, 24),
	line = Color3.fromRGB(255, 255, 255),
	text = Color3.fromRGB(233, 232, 239),
	muted = Color3.fromRGB(154, 152, 168),
	dim = Color3.fromRGB(109, 107, 122),
	accent = Color3.fromRGB(124, 92, 255),
	accentHover = Color3.fromRGB(141, 113, 255),
	accentText = Color3.fromRGB(207, 196, 255),
	switchOff = Color3.fromRGB(58, 57, 67),
	ok = Color3.fromRGB(70, 200, 120),
	warn = Color3.fromRGB(240, 190, 60),
	error = Color3.fromRGB(235, 90, 90),
	idle = Color3.fromRGB(140, 140, 150),
}

Kit.fonts = {
	regular = Font.new("rbxasset://fonts/families/BuilderSans.json", Enum.FontWeight.Regular),
	medium = Font.new("rbxasset://fonts/families/BuilderSans.json", Enum.FontWeight.Medium),
	bold = Font.new("rbxasset://fonts/families/BuilderSans.json", Enum.FontWeight.Bold),
}

local iconRoot = "rbxasset://studio_svg_textures/"
Kit.icons = {
	prompt = iconRoot .. "Shared/WidgetIcons/Dark/Large/Assistant@2x.png",
	studio = iconRoot .. "Shared/WidgetIcons/Dark/Large/ManagePlugins@2x.png",
	tools = iconRoot .. "Shared/WidgetIcons/Dark/Large/Toolbox@2x.png",
	activity = iconRoot .. "Shared/WidgetIcons/Dark/Large/ActivityHistory@2x.png",
	close = iconRoot .. "Shared/Navigation/Dark/Standard/CloseWidget@2x.png",
	add = iconRoot .. "Shared/Navigation/Dark/Standard/AddNoBorder@2x.png",
	send = iconRoot .. "Shared/Navigation/Dark/Standard/ArrowUp@2x.png",
	dropdown = iconRoot .. "Shared/Navigation/Dark/Standard/DropdownArrow@2x.png",
	expand = iconRoot .. "Shared/Navigation/Dark/Standard/Expand@2x.png",
	pick = iconRoot .. "Shared/DraggerTools/Dark/Large/Select@2x.png",
	search = iconRoot .. "Lua/DeveloperFramework/Dark/Standard/Search@2x.png",
	check = iconRoot .. "Lua/Tutorials/Dark/Standard/Checkmark@2x.png",
	refresh = iconRoot .. "Lua/FileSync/Dark/Standard/Refresh@2x.png",
}

local quick = TweenInfo.new(0.12, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)

function Kit.tween(instance: Instance, info: TweenInfo, goal)
	local tween = TweenService:Create(instance, info, goal)
	tween:Play()
	return tween
end

function Kit.new(className: string, props, children)
	local instance = Instance.new(className)
	for key, value in props or {} do
		if key ~= "Parent" then
			instance[key] = value
		end
	end
	for _, child in children or {} do
		child.Parent = instance
	end
	if props and props.Parent then
		instance.Parent = props.Parent
	end
	return instance
end

local new = Kit.new

function Kit.corner(radius: number)
	return new("UICorner", { CornerRadius = UDim.new(0, radius) })
end

function Kit.round()
	return new("UICorner", { CornerRadius = UDim.new(1, 0) })
end

function Kit.pad(top: number, right: number?, bottom: number?, left: number?)
	return new("UIPadding", { PaddingTop = UDim.new(0, top), PaddingRight = UDim.new(0, right or top), PaddingBottom = UDim.new(0, bottom or top), PaddingLeft = UDim.new(0, left or right or top) })
end

function Kit.list(gap: number, horizontal: boolean?, wraps: boolean?)
	local layout = new("UIListLayout", { Padding = UDim.new(0, gap), SortOrder = Enum.SortOrder.LayoutOrder })
	if horizontal then
		layout.FillDirection = Enum.FillDirection.Horizontal
		layout.VerticalAlignment = Enum.VerticalAlignment.Center
	end
	if wraps then
		layout.Wraps = true
	end
	return layout
end

function Kit.stroke(transparency: number?, color: Color3?)
	return new("UIStroke", { Color = color or Kit.colors.line, Transparency = transparency or 0.92, Thickness = 1, ApplyStrokeMode = Enum.ApplyStrokeMode.Border })
end

function Kit.label(props)
	local wrap = props.wrap ~= false
	return new("TextLabel", {
		Name = props.name or "Label",
		BackgroundTransparency = 1,
		FontFace = props.font or Kit.fonts.regular,
		TextSize = props.size or 14,
		TextColor3 = props.color or Kit.colors.text,
		TextXAlignment = props.align or Enum.TextXAlignment.Left,
		TextYAlignment = props.alignY or Enum.TextYAlignment.Center,
		TextWrapped = wrap,
		TextTruncate = if wrap then Enum.TextTruncate.None else Enum.TextTruncate.AtEnd,
		RichText = props.rich == true,
		AutomaticSize = props.automatic or (if props.height then Enum.AutomaticSize.None else Enum.AutomaticSize.Y),
		Size = props.udim or UDim2.new(1, 0, 0, props.height or 0),
		Position = props.position or UDim2.new(),
		Text = props.text or "",
		LayoutOrder = props.order or 0,
		Parent = props.parent,
	})
end

function Kit.icon(props)
	return new("ImageLabel", {
		Name = props.name or "Icon",
		BackgroundTransparency = 1,
		Image = props.image,
		ImageColor3 = props.color or Kit.colors.muted,
		ScaleType = Enum.ScaleType.Fit,
		Size = UDim2.fromOffset(props.size or 18, props.size or 18),
		Position = props.position or UDim2.new(),
		AnchorPoint = props.anchor or Vector2.zero,
		LayoutOrder = props.order or 0,
		Parent = props.parent,
	})
end

function Kit.dot(color: Color3, size: number?, parent: Instance?, order: number?)
	return new("Frame", { Name = "Dot", BackgroundColor3 = color, BorderSizePixel = 0, Size = UDim2.fromOffset(size or 8, size or 8), LayoutOrder = order or 0, Parent = parent }, { Kit.round() })
end

function Kit.hover(button: GuiButton, target: GuiObject, rest: Color3, over: Color3)
	button.MouseEnter:Connect(function()
		Kit.tween(target, quick, { BackgroundColor3 = over })
	end)
	button.MouseLeave:Connect(function()
		Kit.tween(target, quick, { BackgroundColor3 = rest })
	end)
end

function Kit.button(props)
	local primary = props.primary == true
	local rest = if primary then Kit.colors.accent else Kit.colors.card
	local over = if primary then Kit.colors.accentHover else Kit.colors.cardHover
	local button = new("TextButton", {
		Name = props.name or "Button",
		AutoButtonColor = false,
		BackgroundColor3 = rest,
		FontFace = Kit.fonts.medium,
		TextSize = 14,
		TextColor3 = if primary then Color3.new(1, 1, 1) else Kit.colors.text,
		Text = props.text,
		Size = props.udim or UDim2.fromOffset(0, 32),
		AutomaticSize = if props.udim then Enum.AutomaticSize.None else Enum.AutomaticSize.X,
		LayoutOrder = props.order or 0,
		Parent = props.parent,
	}, { Kit.corner(8), Kit.pad(0, 14, 0, 14) })
	if not primary then
		Kit.stroke(0.86).Parent = button
	end
	Kit.hover(button, button, rest, over)
	if props.onClick then
		button.Activated:Connect(props.onClick)
	end
	return button
end

function Kit.iconButton(props)
	local rest = props.background or Kit.colors.panel
	local button = new("ImageButton", {
		Name = props.name or "IconButton",
		AutoButtonColor = false,
		BackgroundColor3 = rest,
		BackgroundTransparency = if props.background then 0 else 1,
		Size = UDim2.fromOffset(props.size or 32, props.size or 32),
		Position = props.position or UDim2.new(),
		AnchorPoint = props.anchor or Vector2.zero,
		LayoutOrder = props.order or 0,
		Parent = props.parent,
	}, { Kit.corner(props.radius or 8) })
	local glyph = Kit.icon({ image = props.image, size = props.iconSize or 16, color = props.color, anchor = Vector2.new(0.5, 0.5), position = UDim2.fromScale(0.5, 0.5), parent = button })
	button.MouseEnter:Connect(function()
		if not props.background then
			button.BackgroundColor3 = Kit.colors.cardHover
			button.BackgroundTransparency = 0
		end
		glyph.ImageColor3 = props.hoverColor or Kit.colors.text
	end)
	button.MouseLeave:Connect(function()
		if not props.background then
			button.BackgroundTransparency = 1
		end
		glyph.ImageColor3 = props.color or Kit.colors.muted
	end)
	if props.onClick then
		button.Activated:Connect(props.onClick)
	end
	return button, glyph
end

function Kit.switch(on: boolean, parent: Instance?, onToggle: (() -> ())?)
	local track = new("TextButton", { Name = "Switch", AutoButtonColor = false, Text = "", BackgroundColor3 = if on then Kit.colors.accent else Kit.colors.switchOff, Size = UDim2.fromOffset(34, 20), Parent = parent }, { Kit.round() })
	local knob = new("Frame", { Name = "Knob", BackgroundColor3 = Color3.new(1, 1, 1), Size = UDim2.fromOffset(16, 16), Position = UDim2.fromOffset(if on then 16 else 2, 2), Parent = track }, { Kit.round() })
	if onToggle then
		track.Activated:Connect(function()
			on = not on
			Kit.tween(track, quick, { BackgroundColor3 = if on then Kit.colors.accent else Kit.colors.switchOff })
			Kit.tween(knob, quick, { Position = UDim2.fromOffset(if on then 16 else 2, 2) })
			onToggle()
		end)
	end
	return track
end

function Kit.check(on: boolean, parent: Instance?)
	local box = new("Frame", { Name = "Check", BackgroundColor3 = if on then Kit.colors.accent else Kit.colors.field, Size = UDim2.fromOffset(16, 16), Parent = parent }, { Kit.corner(5) })
	if on then
		Kit.icon({ image = Kit.icons.check, size = 12, color = Color3.new(1, 1, 1), anchor = Vector2.new(0.5, 0.5), position = UDim2.fromScale(0.5, 0.5), parent = box })
	else
		Kit.stroke(0.8).Parent = box
	end
	return box
end

function Kit.card(parent: Instance?, order: number?, name: string?)
	return new("Frame", { Name = name or "Card", BackgroundColor3 = Kit.colors.card, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, LayoutOrder = order or 0, Parent = parent }, { Kit.corner(10), Kit.stroke(), Kit.list(0) })
end

function Kit.caption(text: string, parent: Instance?, order: number?)
	return Kit.label({ name = "Caption", text = string.upper(text), size = 11, font = Kit.fonts.medium, color = Kit.colors.dim, height = 16, parent = parent, order = order })
end

function Kit.row(props)
	local row = new(if props.onClick then "TextButton" else "Frame", { Name = props.name or "Row", BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, LayoutOrder = props.order or 0, Parent = props.parent }, { Kit.pad(10, 12, 10, props.indent or 12) })
	if props.onClick then
		row.AutoButtonColor = false
		row.Text = ""
		row.BackgroundColor3 = Kit.colors.cardHover
		row.MouseEnter:Connect(function()
			row.BackgroundTransparency = 0.5
		end)
		row.MouseLeave:Connect(function()
			row.BackgroundTransparency = 1
		end)
		row.Activated:Connect(props.onClick)
	end
	if props.divider then
		new("Frame", { Name = "Divider", BackgroundColor3 = Kit.colors.line, BackgroundTransparency = 0.93, BorderSizePixel = 0, Size = UDim2.new(1, 0, 0, 1), Position = UDim2.new(0, 0, 0, -10), Parent = row })
	end
	local leftInset = if props.lead then 26 else 0
	local rightInset = props.trailWidth or 0
	local body = new("Frame", { Name = "Body", BackgroundTransparency = 1, Position = UDim2.fromOffset(leftInset, 0), Size = UDim2.new(1, -leftInset - rightInset, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, Parent = row }, { Kit.list(2) })
	Kit.label({ name = "Title", text = props.title, size = 14, font = Kit.fonts.medium, color = props.titleColor or Kit.colors.text, parent = body, order = 1 })
	if props.hint then
		Kit.label({ name = "Hint", text = props.hint, size = 12, color = Kit.colors.dim, parent = body, order = 2 })
	end
	if props.lead then
		props.lead.AnchorPoint = Vector2.new(0, 0.5)
		props.lead.Position = UDim2.new(0, 0, 0.5, 0)
		props.lead.Parent = row
	end
	if props.trail then
		props.trail.AnchorPoint = Vector2.new(1, 0.5)
		props.trail.Position = UDim2.new(1, 0, 0.5, 0)
		props.trail.Parent = row
	end
	return row
end

function Kit.scroller(parent: Instance?)
	return new("ScrollingFrame", {
		Name = "Scroller",
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		Size = UDim2.fromScale(1, 1),
		CanvasSize = UDim2.new(),
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
		ScrollBarThickness = 4,
		ScrollBarImageColor3 = Kit.colors.dim,
		ScrollingDirection = Enum.ScrollingDirection.Y,
		Parent = parent,
	})
end

function Kit.clear(container: Instance)
	for _, child in container:GetChildren() do
		if not child:IsA("UIListLayout") and not child:IsA("UIPadding") and not child:IsA("UICorner") and not child:IsA("UIStroke") then
			child:Destroy()
		end
	end
end

return Kit
