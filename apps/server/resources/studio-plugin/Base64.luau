--!native
--!nocheck
-- Base64 over buffers: screenshots are megabytes of raw pixels.

local ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local lookup = buffer.create(64)
for i = 1, 64 do
	buffer.writeu8(lookup, i - 1, string.byte(ALPHABET, i))
end

local Base64 = {}

function Base64.encode(input: buffer): string
	local length = buffer.len(input)
	local out = buffer.create(math.ceil(length / 3) * 4)
	local o = 0
	local full = length - length % 3
	local i = 0
	while i < full do
		local n = bit32.bor(
			bit32.lshift(buffer.readu8(input, i), 16),
			bit32.lshift(buffer.readu8(input, i + 1), 8),
			buffer.readu8(input, i + 2)
		)
		buffer.writeu8(out, o, buffer.readu8(lookup, bit32.extract(n, 18, 6)))
		buffer.writeu8(out, o + 1, buffer.readu8(lookup, bit32.extract(n, 12, 6)))
		buffer.writeu8(out, o + 2, buffer.readu8(lookup, bit32.extract(n, 6, 6)))
		buffer.writeu8(out, o + 3, buffer.readu8(lookup, bit32.extract(n, 0, 6)))
		i += 3
		o += 4
	end
	local rest = length - full
	if rest > 0 then
		local a = buffer.readu8(input, full)
		local b = if rest == 2 then buffer.readu8(input, full + 1) else 0
		local n = bit32.bor(bit32.lshift(a, 16), bit32.lshift(b, 8))
		buffer.writeu8(out, o, buffer.readu8(lookup, bit32.extract(n, 18, 6)))
		buffer.writeu8(out, o + 1, buffer.readu8(lookup, bit32.extract(n, 12, 6)))
		buffer.writeu8(out, o + 2, if rest == 2 then buffer.readu8(lookup, bit32.extract(n, 6, 6)) else 61)
		buffer.writeu8(out, o + 3, 61)
	end
	return buffer.tostring(out)
end

local reverse = {}
for i = 1, 64 do
	reverse[string.byte(ALPHABET, i)] = i - 1
end

function Base64.decode(input: string): buffer
	local clean = string.gsub(input, "[^%w%+/]", "")
	local length = #clean
	local out = buffer.create(math.floor(length * 3 / 4))
	local o = 0
	local i = 1
	while i + 3 <= length do
		local a, b, c, d = string.byte(clean, i, i + 3)
		local n = bit32.bor(bit32.lshift(reverse[a], 18), bit32.lshift(reverse[b], 12), bit32.lshift(reverse[c], 6), reverse[d])
		buffer.writeu8(out, o, bit32.extract(n, 16, 8))
		buffer.writeu8(out, o + 1, bit32.extract(n, 8, 8))
		buffer.writeu8(out, o + 2, bit32.extract(n, 0, 8))
		o += 3
		i += 4
	end
	local rest = length - i + 1
	if rest >= 2 then
		local a, b = string.byte(clean, i, i + 1)
		local c = if rest == 3 then reverse[string.byte(clean, i + 2)] else 0
		local n = bit32.bor(bit32.lshift(reverse[a], 18), bit32.lshift(reverse[b], 12), bit32.lshift(c, 6))
		buffer.writeu8(out, o, bit32.extract(n, 16, 8))
		if rest == 3 then
			buffer.writeu8(out, o + 1, bit32.extract(n, 8, 8))
		end
	end
	return out
end

return Base64
