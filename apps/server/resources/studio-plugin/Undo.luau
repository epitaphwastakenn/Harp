--!nocheck

local CollectionService = game:GetService("CollectionService")

local Util = require(script.Parent.Util)
local Scripts = require(script.Parent.Handlers.Scripts)

local Undo = {}

local MAX_PER_KEY = 100
local MAX_KEYS = 20

local stores = {}
local keyOrder = {}
local counter = 0

local function storeFor(key: string)
	local store = stores[key]
	if store then
		return store
	end
	store = { order = {}, items = {} }
	stores[key] = store
	table.insert(keyOrder, key)
	if #keyOrder > MAX_KEYS then
		stores[table.remove(keyOrder, 1)] = nil
	end
	return store
end

local function keep(key: string, item): string
	local store = storeFor(key)
	counter += 1
	local token = string.format("u:%x:%d", os.time(), counter)
	store.items[token] = item
	table.insert(store.order, token)
	if #store.order > MAX_PER_KEY then
		store.items[table.remove(store.order, 1)] = nil
	end
	return token
end

local function take(key: string, token: string)
	local store = stores[key]
	local item = store and store.items[token]
	if item == nil then
		return nil
	end
	return item
end

local function drop(key: string, token: string)
	local store = stores[key]
	if store then
		store.items[token] = nil
		local at = table.find(store.order, token)
		if at then
			table.remove(store.order, at)
		end
	end
end

function Undo.requested(args): string?
	local key = args and args.captureUndo
	return if type(key) == "string" and key ~= "" then key else nil
end

function Undo.hold(key: string, instance: Instance, parent: Instance?): string
	local origin = parent or instance.Parent
	return keep(key, { instance = instance, parent = origin, parentPath = Util.pathOf(origin) })
end

function Undo.journal(key: string, actions): string
	return keep(key, { actions = actions })
end

local SIMPLE = { number = true, string = true, boolean = true }
local ENCODED = {
	Vector3 = true, Vector2 = true, Color3 = true, UDim2 = true, UDim = true, CFrame = true,
	EnumItem = true, BrickColor = true, NumberRange = true, Rect = true,
}

function Undo.snapshotValue(value)
	local kind = typeof(value)
	if kind == "Instance" or kind == "nil" then
		return { k = "Instance", v = if value then Util.refOf(value) else false }
	elseif SIMPLE[kind] or ENCODED[kind] then
		return { k = kind, v = Util.encode(value) }
	elseif kind == "Content" then
		local ok, uri = pcall(function()
			return value.Uri
		end)
		if ok and type(uri) == "string" then
			return { k = "Content", v = uri }
		end
	end
	return { k = "unsupported", t = kind }
end

local function deepEqual(a, b): boolean
	if type(a) ~= type(b) then
		return false
	end
	if type(a) ~= "table" then
		return a == b
	end
	for key, value in a do
		if not deepEqual(value, b[key]) then
			return false
		end
	end
	for key in b do
		if a[key] == nil then
			return false
		end
	end
	return true
end

local function sameSnapshot(a, b): boolean
	if a == false or b == false then
		return a == b
	end
	return a.k ~= "unsupported" and a.k == b.k and deepEqual(a.v, b.v)
end

local function resolveInstance(entry): Instance?
	if type(entry.ref) == "string" then
		local found = Util.resolve({ instanceRef = entry.ref })
		if found then
			return found
		end
	end
	if type(entry.path) == "string" and entry.path ~= "" then
		return Util.resolvePath(entry.path)
	end
	return nil
end

local function valueFrom(snapshot, current, name: string?)
	if snapshot.k == "unsupported" then
		return nil, "its earlier value is a " .. tostring(snapshot.t) .. ", which cannot be restored"
	end
	if snapshot.k == "Instance" then
		if snapshot.v == false then
			return nil, nil
		end
		local found, problem = Util.resolve({ instanceRef = snapshot.v })
		if found == nil then
			return nil, problem
		end
		return found, nil
	end
	return Util.decode(snapshot.v, current, name)
end

local function lf(text: string): string
	return (string.gsub(text, "\r\n", "\n"))
end

local function restoreScript(entry)
	local container = resolveInstance(entry)
	if container == nil or not container:IsA("LuaSourceContainer") then
		return "skipped", "the script no longer exists"
	end
	local current = Scripts.sourceOf(container)
	if lf(current) == lf(entry.source) then
		return "restored", nil
	end
	local expectedText = entry.expectedSource
	local matches = if type(expectedText) == "string"
		then lf(current) == lf(expectedText)
		else type(entry.expectedRevision) == "string" and Util.revision(current) == entry.expectedRevision
	if not matches then
		if entry.lenient then
			return "restored", nil
		end
		return "skipped", "the script changed since the agent wrote it"
	end
	local method, problem = Scripts.apply(container, current, entry.source)
	if method == nil then
		return "skipped", problem
	end
	return "restored", nil
end

local function restoreProperties(entry)
	local instance = resolveInstance(entry)
	if instance == nil then
		return "skipped", "the instance no longer exists"
	end
	local restored = 0
	local problems = {}
	local names = {}
	for name in entry.props or {} do
		table.insert(names, name)
	end
	table.sort(names, function(a, b)
		if a == "Parent" then
			return false
		elseif b == "Parent" then
			return true
		end
		return a < b
	end)
	for _, name in names do
		local change = entry.props[name]
		local ok, current = pcall(function()
			return instance[name]
		end)
		if not ok then
			table.insert(problems, name .. " cannot be read")
		else
			local now = Undo.snapshotValue(current)
			if now.k ~= "unsupported" and sameSnapshot(now, change.before) then
				restored += 1
			elseif now.k == "unsupported" or not sameSnapshot(now, change.after) then
				table.insert(problems, name .. " changed since the agent set it")
			else
				local value, problem = valueFrom(change.before, current, name)
				if problem then
					table.insert(problems, name .. ": " .. problem)
				else
					local setOk, err = pcall(function()
						instance[name] = value
					end)
					if setOk then
						restored += 1
					else
						table.insert(problems, name .. ": " .. tostring(err))
					end
				end
			end
		end
	end
	for name, change in entry.attrs or {} do
		local current = instance:GetAttribute(name)
		local now = if current == nil then false else Undo.snapshotValue(current)
		if sameSnapshot(now, change.before) then
			restored += 1
		elseif not sameSnapshot(now, change.after) then
			table.insert(problems, "attribute " .. name .. " changed since the agent set it")
		elseif change.before == false then
			instance:SetAttribute(name, nil)
			restored += 1
		else
			local raw = if SIMPLE[change.before.k] then change.before.v else { type = change.before.k, value = change.before.v }
			local value, problem = Util.decodeAttribute(raw, nil)
			if problem then
				table.insert(problems, "attribute " .. name .. ": " .. problem)
			else
				instance:SetAttribute(name, value)
				restored += 1
			end
		end
	end
	for _, tag in entry.tagsAdded or {} do
		if CollectionService:HasTag(instance, tag) then
			CollectionService:RemoveTag(instance, tag)
		end
		restored += 1
	end
	for _, tag in entry.tagsRemoved or {} do
		if not CollectionService:HasTag(instance, tag) then
			CollectionService:AddTag(instance, tag)
		end
		restored += 1
	end
	if #problems == 0 then
		return "restored", nil
	end
	return if restored > 0 then "partial" else "skipped", table.concat(problems, "; ")
end

local function restoreHeld(key: string, entry)
	local item = take(key, entry.token)
	if item == nil then
		return "skipped", "Studio no longer holds the removed instance (the plugin reloaded, or the turn removed more than " .. MAX_PER_KEY .. ")"
	end
	local instance = item.instance
	if instance.Parent ~= nil then
		drop(key, entry.token)
		return "skipped", "it is already back in the place"
	end
	local parent = item.parent
	if parent == nil or not (parent == game or parent:IsDescendantOf(game)) then
		parent = if item.parentPath then Util.resolvePath(item.parentPath) else nil
	end
	if parent == nil then
		return "skipped", "its parent no longer exists"
	end
	local ok, err = pcall(function()
		instance.Parent = parent
	end)
	if not ok then
		return "skipped", tostring(err)
	end
	drop(key, entry.token)
	return "restored", nil
end

local function resolveCreated(entry): Instance?
	if type(entry.ref) == "string" then
		return Util.resolve({ instanceRef = entry.ref })
	end
	if type(entry.path) ~= "string" or entry.path == "" then
		return nil
	end
	local found = Util.resolvePath(entry.path)
	if found == nil or type(entry.className) ~= "string" or found.ClassName ~= entry.className then
		return nil
	end
	local parent = found.Parent
	if parent ~= nil then
		for _, sibling in parent:GetChildren() do
			if sibling ~= found and sibling.Name == found.Name and sibling.ClassName == found.ClassName then
				return nil
			end
		end
	end
	return found
end

local function restoreCreated(entry)
	local instance = resolveCreated(entry)
	if instance == nil or instance.Parent == nil then
		return "restored", nil
	end
	local ok, err = pcall(function()
		instance.Parent = nil
	end)
	if not ok then
		return "skipped", tostring(err)
	end
	return "restored", nil
end

local function restoreJournal(key: string, entry)
	local item = take(key, entry.token)
	if item == nil then
		return "skipped", "Studio no longer remembers this build (the plugin reloaded, or the thread made more than " .. MAX_PER_KEY .. " changes)"
	end
	for _, action in item.actions do
		if action.holds ~= nil then
			local ok, holds = pcall(action.holds)
			if not ok or not holds then
				return "skipped", "changed since the agent built it (" .. tostring(action.label) .. ")"
			end
		end
	end
	local failures = {}
	for i = #item.actions, 1, -1 do
		local action = item.actions[i]
		local ok, err = pcall(action.undo)
		if not ok then
			table.insert(failures, tostring(action.label) .. ": " .. tostring(err))
		end
	end
	drop(key, entry.token)
	if #failures > 0 then
		return "partial", table.concat(failures, "; ")
	end
	return "restored", nil
end

local function restoreOne(key: string, entry)
	local kind = entry.kind
	if kind == "script" then
		return restoreScript(entry)
	elseif kind == "properties" then
		return restoreProperties(entry)
	elseif kind == "deleted" then
		return restoreHeld(key, entry)
	elseif kind == "created" then
		return restoreCreated(entry)
	elseif kind == "journal" then
		return restoreJournal(key, entry)
	end
	return "skipped", "unknown change kind " .. tostring(kind)
end

function Undo.apply(args)
	local entries = args.entries
	if type(entries) ~= "table" or #entries == 0 then
		return { error = "entries must be a non-empty array" }
	end
	local key = if type(args.undoKey) == "string" then args.undoKey else ""
	local recording = Util.beginRecording("Undo agent changes")
	local results = {}
	for index, entry in entries do
		local ok, status, reason = pcall(restoreOne, key, entry)
		if ok then
			results[index] = { status = status, reason = reason }
		else
			results[index] = { status = "skipped", reason = "failed: " .. string.sub(tostring(status), 1, 200) }
		end
	end
	Util.finishRecording(recording, true)
	return { success = true, results = results, undoable = recording ~= nil }
end

return Undo
