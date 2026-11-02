--!nocheck

local Catalog = require(script.Parent.Parent.Catalog)
local State = require(script.Parent.Parent.State)
local Kit = require(script.Parent.Parent.Ui.Kit)

local colors = Kit.colors
local new = Kit.new

local Page = {}

local titles = {}
for _, group in Catalog do
	for _, tool in group.tools do
		titles[tool[1]] = tool[2]
	end
end

local stateColors = { running = colors.accent, ok = colors.ok, error = colors.error }

function Page.create(frame: Frame)
	local scroller = Kit.scroller(frame)
	local body = new("Frame", { Name = "Body", BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, Parent = scroller }, { Kit.pad(2, 16, 16, 16), Kit.list(8) })

	local function refresh()
		Kit.clear(body)
		if #State.activity == 0 then
			local empty = Kit.card(body, 1, "Empty")
			Kit.row({ title = "Nothing yet", hint = "What the agent does in this Studio shows up here, newest first.", parent = empty })
			return
		end
		local card = Kit.card(body, 1, "Entries")
		for i, entry in State.activity do
			local title = titles[entry.tool] or tostring(entry.tool)
			local hint = entry.error or entry.summary or entry.tool
			local timing = tostring(entry.time or "")
			if entry.durationMs then
				timing ..= string.format(" · %.1fs", entry.durationMs / 1000)
			end
			local when = Kit.label({ text = timing, size = 12, color = colors.dim, wrap = false, align = Enum.TextXAlignment.Right, udim = UDim2.fromOffset(96, 18) })
			local dot = Kit.dot(stateColors[entry.state] or colors.idle, 8)
			Kit.row({ title = title, hint = tostring(hint), titleColor = if entry.state == "error" then colors.error else colors.text, lead = dot, trailWidth = 100, trail = when, divider = i > 1, parent = card, order = i })
		end
	end

	return { refresh = refresh, shown = refresh }
end

return Page
