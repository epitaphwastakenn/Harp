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
	hash = mix(hash, tostring(root.Parent and root.Parent:GetFullName() or ""))
	for _, instance in root:GetDescendants() do
		count += 1
		if count > MAX_INSTANCES then
			partial = true
			break
		end
		hash = mix(hash, instance.Name .. ":" .. instance.ClassName .. ":" .. (instance.Parent and instance.Parent:GetFullName() or ""))
		if instance:IsA("BasePart") then
			local ok, text = pcall(function()
				local cf = instance.CFrame
				local size = instance.Size
				return string.format("%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f", cf:GetComponents()) .. string.format(",%.3f,%.3f,%.3f", size.X, size.Y, size.Z)
			end)
			if ok then
				hash = mix(hash, text)
			end
		end
		local attributes = instance:GetAttributes()
		local attributeSum = 0
		for name, value in attributes do
			attributeSum = (attributeSum + mix(5381, name .. "=" .. tostring(value))) % 4294967296
		end
		hash = mix(hash, tostring(attributeSum))
		local tags = instance:GetTags()
		table.sort(tags)
		hash = mix(hash, table.concat(tags, ","))
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
	local roots = {}
	for index, path in paths do
		if index > 50 then
			break
		end
		if type(path) == "string" then
			local root = Util.resolvePath(path)
			if root then
				roots[path] = root
			else
				snapshots[path] = false
			end
		end
	end
	for path, root in roots do
		local covered = false
		for otherPath, other in roots do
			if otherPath ~= path and root ~= other and root:IsDescendantOf(other) then
				covered = true
				break
			end
		end
		if not covered then
			snapshots[path] = fingerprint(root)
		end
	end
	return snapshots
end

function Protected.changed(before, paths)
	local changed = {}
	local partial = {}
	if type(paths) ~= "table" then
		return changed, partial
	end
	local after = Protected.snapshot(paths)
	for path, was in before do
		local now = after[path]
		if now == nil then
			continue
		end
		if (was and was.partial) or (now and now.partial) then
			table.insert(partial, path)
		end
		if was == false or now == false then
			if was ~= now then
				table.insert(changed, path)
			end
		elseif was.hash ~= now.hash or was.count ~= now.count then
			table.insert(changed, path)
		end
	end
	table.sort(changed)
	table.sort(partial)
	return changed, partial
end

return Protected
