--!nocheck

local HttpService = game:GetService("HttpService")
local Selection = game:GetService("Selection")

local Describe = require(script.Parent.Describe)
local Lifetime = require(script.Parent.Lifetime)
local State = require(script.Parent.State)
local Transport = require(script.Parent.Transport)

local Prompt = {}

local maxAttachments = 12

Prompt.targets = {}
Prompt.targetsLoaded = false
Prompt.targetsError = nil
Prompt.canCreate = false
Prompt.choice = nil
Prompt.attachments = {}
Prompt.picking = false
Prompt.sending = false
Prompt.sendError = nil
Prompt.current = nil

local function targetById(threadId: string?)
	for _, target in Prompt.targets do
		if target.threadId == threadId then
			return target
		end
	end
	return nil
end

function Prompt.choiceLabel()
	if Prompt.choice == "new" then
		return "New thread", "Same project and model as the latest thread"
	end
	local target = targetById(Prompt.choice)
	if target == nil then
		return if Prompt.targetsLoaded then "No thread yet" else "Loading threads…", if Prompt.targetsError then Prompt.targetsError else "Open a Roblox project thread in Harp"
	end
	local where = if target.linked then "Linked to this place" else target.projectTitle
	return target.title, string.format("%s · %s", where, target.model)
end

function Prompt.choiceTarget()
	return targetById(Prompt.choice)
end

function Prompt.refreshTargets()
	task.spawn(function()
		local ok, result, err = Transport.call("/studio/v1/prompt/targets", {})
		if ok then
			Prompt.targets = result.targets or {}
			Prompt.canCreate = result.canCreate == true
			Prompt.targetsError = nil
			if Prompt.choice ~= "new" and targetById(Prompt.choice) == nil then
				Prompt.choice = result.defaultThreadId
			end
		else
			Prompt.targetsError = err
		end
		Prompt.targetsLoaded = true
		State.changed()
	end)
end

function Prompt.choose(threadId)
	Prompt.choice = threadId
	State.changed()
end

local function attachedIndex(instance: Instance): number?
	for i, entry in Prompt.attachments do
		if entry.instance == instance then
			return i
		end
	end
	return nil
end

function Prompt.attach(instances: { Instance })
	local added = false
	for _, instance in instances do
		if #Prompt.attachments >= maxAttachments then
			break
		end
		if instance ~= game and instance.Parent ~= nil and attachedIndex(instance) == nil then
			table.insert(Prompt.attachments, { instance = instance, name = instance.Name, className = instance.ClassName })
			added = true
		end
	end
	if added then
		State.changed()
	end
	return added
end

function Prompt.attachSelection(): boolean
	return Prompt.attach(Selection:Get())
end

function Prompt.detach(instance: Instance)
	local index = attachedIndex(instance)
	if index then
		table.remove(Prompt.attachments, index)
		State.changed()
	end
end

function Prompt.setPicking(on: boolean)
	Prompt.picking = on
	State.changed()
end

Lifetime.connect(Selection.SelectionChanged, function()
	if Prompt.picking and Prompt.attachSelection() then
		Prompt.picking = false
		State.changed()
	end
end)

local polling = 0

local function pollStatus(threadId: string)
	polling += 1
	local mine = polling
	task.spawn(function()
		local started = os.clock()
		local quietRounds = 0
		while Lifetime.alive and mine == polling and os.clock() - started < 1800 do
			task.wait(1.5)
			if not Lifetime.alive or mine ~= polling then
				return
			end
			local ok, result = Transport.call("/studio/v1/prompt/status", { threadId = threadId })
			if ok and Prompt.current and Prompt.current.threadId == threadId then
				Prompt.current.state = result.state
				Prompt.current.title = result.title
				Prompt.current.reply = result.reply
				Prompt.current.error = result.error
				State.changed()
				if result.state ~= "working" and result.state ~= "waiting" then
					quietRounds += 1
					if quietRounds >= 2 then
						return
					end
				else
					quietRounds = 0
				end
			end
		end
	end)
end

function Prompt.send(text: string): boolean
	local trimmed = string.gsub(text, "^%s+", "")
	trimmed = string.gsub(trimmed, "%s+$", "")
	if trimmed == "" or Prompt.sending then
		return false
	end
	local target
	if Prompt.choice == "new" then
		target = { kind = "new" }
	elseif Prompt.choice ~= nil then
		target = { kind = "thread", threadId = Prompt.choice }
	else
		Prompt.sendError = "Pick a thread to send to."
		State.changed()
		return false
	end
	Prompt.sending = true
	Prompt.sendError = nil
	State.changed()
	local attachments = {}
	for _, entry in Prompt.attachments do
		if entry.instance.Parent ~= nil then
			local ok, described = pcall(Describe.attachment, entry.instance)
			if ok then
				table.insert(attachments, described)
			end
		end
	end
	local requestId = string.lower(string.gsub(HttpService:GenerateGUID(false), "[{}]", ""))
	local ok, result, err = Transport.call("/studio/v1/prompt/send", { requestId = requestId, text = trimmed, target = target, attachments = attachments })
	Prompt.sending = false
	if not ok then
		Prompt.sendError = err or "Harp did not take the prompt."
		State.changed()
		return false
	end
	Prompt.attachments = {}
	Prompt.picking = false
	Prompt.choice = result.threadId
	Prompt.current = { threadId = result.threadId, title = result.title, state = "working", delivery = result.delivery, prompt = trimmed, reply = nil, error = nil }
	State.changed()
	pollStatus(result.threadId)
	Prompt.refreshTargets()
	return true
end

function Prompt.dismiss()
	polling += 1
	Prompt.current = nil
	State.changed()
end

return Prompt
