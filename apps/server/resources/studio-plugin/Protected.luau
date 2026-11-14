--!nocheck
-- Cheap fingerprints of the subtrees the user protected, compared around agent Luau.

local Util = require(script.Parent.Util)

local Protected = {}

local MAX_INSTANCES = 20000
local MAX_SOURCE_BYTES = 1024 * 1024
local MAX_SOURCE_SCRIPT_BYTES = 128 * 1024

local function mix(hash: number, text: string): number
	for i = 1, #text do
		hash = (hash * 31 + string.byte(text, i)) % 4294967296
	end
	return (hash * 31 + 7) % 4294967296
end

local function fingerprint(root: Instance)
	local hash = 5381
	local count = 0
	local sourceBytes = 0
	local partial = false
	hash = mix(hash, root.ClassName .. root.Name)
	for _, instance in root:GetDescendants() do
		count += 1
		if count > MAX_INSTANCES then
			partial = true
			break
		end
		hash = mix(hash, instance.Name .. ":" .. instance.ClassName .. ":" .. (instance.Parent and instance.Parent.Name or ""))
		if instance:IsA("LuaSourceContainer") then
			local ok, source = pcall(function()
				return instance.Source
			end)
			if ok then
				if sourceBytes + #source <= MAX_SOURCE_BYTES and #source <= MAX_SOURCE_SCRIPT_BYTES then
					sourceBytes += #source
					hash = mix(hash, Util.revision(source))
				else
					partial = true
					hash = mix(hash, tostring(#source))
				end
			end
		end
	end
	return { hash = hash, count = count, partial = partial }
end

function Protected.snapshot(paths)
	local snapshots = {}
	if type(paths) ~= "table" then
		return snapshots
	end
	for index, path in paths do
		if index > 50 then
			break
		end
		local root = Util.resolvePath(path)
		snapshots[path] = if root then fingerprint(root) else false
	end
	return snapshots
end

function Protected.changed(before, paths)
	local changed = {}
	if type(paths) ~= "table" then
		return changed
	end
	local after = Protected.snapshot(paths)
	for path, was in before do
		local now = after[path]
		if was == false or now == false then
			if was ~= now then
				table.insert(changed, path)
			end
		elseif was.hash ~= now.hash or was.count ~= now.count then
			table.insert(changed, path)
		end
	end
	table.sort(changed)
	return changed
end

return Protected
