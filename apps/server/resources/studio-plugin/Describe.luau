--!nocheck

local CollectionService = game:GetService("CollectionService")
local HttpService = game:GetService("HttpService")

local Util = require(script.Parent.Util)

local Describe = {}

local maxChars = 58000
local maxSourceChars = 40000

local properties = {
	"Enabled", "Disabled", "RunContext", "Archivable",
	"Position", "Orientation", "Size", "Anchored", "CanCollide", "CanTouch", "CanQuery", "Massless",
	"Transparency", "Color", "Material", "Shape", "MeshId", "TextureID", "CollisionFidelity",
	"PrimaryPart", "WorldPivot",
	"AnchorPoint", "Visible", "ZIndex", "LayoutOrder", "BackgroundColor3", "BackgroundTransparency",
	"Text", "TextSize", "TextColor3", "FontFace", "Image", "ImageColor3", "ScaleType",
	"ResetOnSpawn", "ZIndexBehavior", "IgnoreGuiInset", "DisplayOrder",
	"Brightness", "Range", "Shadows", "Angle",
	"SoundId", "Volume", "Looped", "PlaybackSpeed",
	"Rate", "Lifetime", "Speed", "Texture", "LightEmission",
	"Health", "MaxHealth", "WalkSpeed", "JumpPower", "RigType",
	"AnimationId", "Value", "C0", "C1", "Part0", "Part1",
}

local function encodeValue(value): string
	local encoded = Util.encode(value)
	if type(encoded) == "table" then
		local ok, text = pcall(HttpService.JSONEncode, HttpService, encoded)
		return if ok then text else tostring(value)
	end
	return tostring(encoded)
end

local function propertyLines(instance: Instance): { string }
	local lines = {}
	for _, name in properties do
		local ok, value = pcall(function()
			return instance[name]
		end)
		if ok and value ~= nil and typeof(value) ~= "RBXScriptSignal" and typeof(value) ~= "function" then
			table.insert(lines, string.format("- %s: %s", name, string.sub(encodeValue(value), 1, 300)))
		end
	end
	return lines
end

local function attributeLines(instance: Instance): { string }
	local lines = {}
	for name, value in instance:GetAttributes() do
		table.insert(lines, string.format("- %s: %s", name, string.sub(encodeValue(value), 1, 300)))
		if #lines >= 30 then
			break
		end
	end
	table.sort(lines)
	return lines
end

local function sourceOf(container: Instance): string?
	local ok, source = pcall(function()
		return game:GetService("ScriptEditorService"):GetEditorSource(container)
	end)
	if ok and type(source) == "string" then
		return source
	end
	local okRaw, raw = pcall(function()
		return container.Source
	end)
	return if okRaw then raw else nil
end

local function contents(instance: Instance): { string }
	local lines = {}
	local descendants = instance:GetDescendants()
	if #descendants == 0 then
		return lines
	end
	local counts = {}
	for _, descendant in descendants do
		counts[descendant.ClassName] = (counts[descendant.ClassName] or 0) + 1
	end
	local classes = {}
	for className, count in counts do
		table.insert(classes, { className, count })
	end
	table.sort(classes, function(a, b)
		return a[2] > b[2]
	end)
	local parts = {}
	for i, entry in classes do
		if i > 12 then
			break
		end
		table.insert(parts, string.format("%s %d", entry[1], entry[2]))
	end
	table.insert(lines, string.format("%d descendants: %s", #descendants, table.concat(parts, ", ")))
	table.insert(lines, "")
	table.insert(lines, "Children:")
	local children = instance:GetChildren()
	for i, child in children do
		if i > 40 then
			table.insert(lines, string.format("- … and %d more", #children - 40))
			break
		end
		local below = #child:GetDescendants()
		table.insert(lines, string.format("- %s (%s)%s", child.Name, child.ClassName, if below > 0 then string.format(", %d inside", below) else ""))
	end
	return lines
end

function Describe.details(instance: Instance): string
	local out = {}
	local function section(title: string, lines: { string })
		if #lines == 0 then
			return
		end
		table.insert(out, "## " .. title)
		for _, line in lines do
			table.insert(out, line)
		end
		table.insert(out, "")
	end
	section("Properties", propertyLines(instance))
	if instance:IsA("Model") then
		local ok, cframe, size = pcall(function()
			return instance:GetBoundingBox()
		end)
		if ok then
			section("Bounds", { "- Center: " .. encodeValue(cframe.Position), "- Size: " .. encodeValue(size) })
		end
	end
	section("Attributes", attributeLines(instance))
	local tags = CollectionService:GetTags(instance)
	if #tags > 0 then
		section("Tags", { "- " .. table.concat(tags, ", ") })
	end
	if instance:IsA("LuaSourceContainer") then
		local source = sourceOf(instance)
		if source then
			local lineCount = select(2, string.gsub(source, "\n", "")) + 1
			local shown = string.sub(source, 1, maxSourceChars)
			local note = if #source > maxSourceChars then string.format(" (first %d of %d characters)", maxSourceChars, #source) else ""
			table.insert(out, string.format("## Source, %d lines%s", lineCount, note))
			table.insert(out, "```lua")
			table.insert(out, shown)
			table.insert(out, "```")
			table.insert(out, "")
		end
	end
	section("Contents", contents(instance))
	local text = table.concat(out, "\n")
	if #text > maxChars then
		text = string.sub(text, 1, maxChars) .. "\n…(cut)"
	end
	return text
end

function Describe.attachment(instance: Instance)
	return {
		path = Util.pathOf(instance) or instance:GetFullName(),
		className = instance.ClassName,
		name = string.sub(instance.Name, 1, 200),
		details = Describe.details(instance),
	}
end

return Describe
