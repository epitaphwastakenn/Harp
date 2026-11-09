--!nocheck

local Util = require(script.Parent.Util)
local Lifetime = require(script.Parent.Lifetime)

local ScriptIndex = {}

local scripts = {}
local state = "empty"

local function add(instance: Instance)
	if instance:IsA("LuaSourceContainer") then
		scripts[instance] = true
	end
end

local function remove(instance: Instance)
	scripts[instance] = nil
end

local function fill()
	for _, name in Util.ROOT_SERVICES do
		local ok, service = pcall(function()
			return game:FindService(name)
		end)
		if ok and service then
			Lifetime.connect(service.DescendantAdded, add)
			Lifetime.connect(service.DescendantRemoving, remove)
		end
	end
	Util.walk(nil, function(instance)
		add(instance)
		return false
	end)
end

local function build(): boolean
	while state == "building" do
		task.wait()
	end
	if state == "ready" or state == "failed" then
		return state == "ready"
	end
	state = "building"
	state = if pcall(fill) then "ready" else "failed"
	return state == "ready"
end

local function indexed(root: Instance?, ordered: boolean)
	local list = {}
	for instance in scripts do
		if root == nil or instance == root or instance:IsDescendantOf(root) then
			table.insert(list, instance)
		end
	end
	if ordered then
		local names = {}
		for _, instance in list do
			names[instance] = instance:GetFullName()
		end
		table.sort(list, function(left, right)
			return names[left] < names[right]
		end)
	end
	return list
end

local function walked(root: Instance?)
	local list = {}
	Util.walk(root, function(instance)
		if instance:IsA("LuaSourceContainer") then
			table.insert(list, instance)
		end
		return false
	end)
	return list
end

function ScriptIndex.each(root: Instance?, ordered: boolean, visit: (Instance) -> boolean?)
	local ok, list = false, nil
	if build() then
		ok, list = pcall(indexed, root, ordered)
	end
	if not ok then
		list = walked(root)
	end
	local started = os.clock()
	for _, instance in list do
		if os.clock() - started > 0.008 then
			task.wait()
			started = os.clock()
		end
		if visit(instance) then
			return
		end
	end
end

return ScriptIndex
