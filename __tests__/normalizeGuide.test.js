const { normalizeGuide, text, strings, validateGuide } = require('../cloudfunctions/contentGuideManage/index')._test || {};

describe('normalizeGuide suite', () => {

    describe('text utility function', () => {
        it('should truncate string to given max length', () => {
            expect(text('abcdefg', 3)).toBe('abc');
            expect(text('a'.repeat(100), 50)).toBe('a'.repeat(50));
        });

        it('should trim string before processing', () => {
            expect(text('  abc  ', 10)).toBe('abc');
            expect(text('  abc  ', 2)).toBe('ab');
        });

        it('should handle undefined, null, and non-strings', () => {
            expect(text(undefined, 10)).toBe('');
            expect(text(null, 10)).toBe('');
            expect(text(12345, 10)).toBe('12345');
            expect(text({}, 10)).toBe('[object Ob'); // '[object Object]' truncated to 10
            expect(text({}, 15)).toBe('[object Object]');
        });
    });

    describe('strings utility function', () => {
        it('should handle undefined or null input', () => {
            expect(strings(undefined, 10, 10)).toEqual([]);
            expect(strings(null, 10, 10)).toEqual([]);
            expect(strings("not_an_array", 10, 10)).toEqual([]);
        });

        it('should filter out empty strings and non-truthy values', () => {
            expect(strings(['abc', '', null, 'def', undefined, false, 'ghi'], 10, 10)).toEqual(['abc', 'def', 'ghi']);
        });

        it('should enforce unique items', () => {
            expect(strings(['abc', 'def', 'abc', 'ghi', 'def'], 10, 10)).toEqual(['abc', 'def', 'ghi']);
        });

        it('should apply text constraints (trim, max length) to each item', () => {
            expect(strings(['  abc  ', 'abcdef', '  ghi'], 10, 4)).toEqual(['abc', 'abcd', 'ghi']);
        });

        it('should enforce max item count', () => {
            expect(strings(['a', 'b', 'c', 'd', 'e'], 3, 10)).toEqual(['a', 'b', 'c']);
        });
    });

    describe('normalizeGuide function', () => {
        it('should safely normalize a completely missing or empty object', () => {
            const result = normalizeGuide({});
            expect(result).toEqual({
                slug: '',
                title: '',
                summary: '',
                body: '',
                contentType: '',
                scenario: '',
                vehicleIds: [],
                tags: [],
                shareTitle: ''
            });
        });

        it('should safely normalize with valid inputs and respect length limits', () => {
            const input = {
                slug: 'my-cool-guide',
                title: 'A very cool guide title that could be long',
                summary: 'Some summary',
                body: 'The body content',
                contentType: 'guide',
                scenario: 'weekend_trip',
                vehicleIds: ['id1', 'id2', 'id1', 'bad_id@!#'],
                tags: ['tag1', 'tag2', '  tag1  ', '', 'tag3'],
                shareTitle: 'Share me!'
            };

            const result = normalizeGuide(input);
            expect(result).toEqual({
                slug: 'my-cool-guide',
                title: 'A very cool guide title that could be long',
                summary: 'Some summary',
                body: 'The body content',
                contentType: 'guide',
                scenario: 'weekend_trip',
                vehicleIds: ['id1', 'id2'], // Unique and passed pattern /^[A-Za-z0-9_-]{1,64}$/
                tags: ['tag1', 'tag2', 'tag3'], // Unique and filtered truthy
                shareTitle: 'Share me!'
            });
        });

        it('should enforce maximum lengths defined in the function', () => {
            const input = {
                slug: 'a'.repeat(100),
                title: 'b'.repeat(150),
                summary: 'c'.repeat(400),
                body: 'd'.repeat(25000),
                contentType: 'e'.repeat(50),
                scenario: 'f'.repeat(50),
                vehicleIds: ['v'.repeat(70)],
                tags: Array.from({length: 30}, (_, i) => `t${i}`.padEnd(40, 'x')),
                shareTitle: 's'.repeat(150)
            };

            const result = normalizeGuide(input);
            expect(result.slug).toBe('a'.repeat(64));
            expect(result.title).toBe('b'.repeat(100));
            expect(result.summary).toBe('c'.repeat(300));
            expect(result.body).toBe('d'.repeat(20000));
            expect(result.contentType).toBe('e'.repeat(32));
            expect(result.scenario).toBe('f'.repeat(32));

            // 'v'.repeat(70) is sliced to 64 length, which matches ID_PATTERN
            expect(result.vehicleIds).toEqual(['v'.repeat(64)]);

            expect(result.tags.length).toBe(20);
            expect(result.tags[0]).toBe('t0' + 'x'.repeat(28)); // length 30
            expect(result.shareTitle).toBe('s'.repeat(100));
        });
    });

    describe('validateGuide function', () => {
        it('should return empty array for valid guide', () => {
            const guide = {
                slug: 'valid-slug',
                title: 'valid title',
                summary: 'valid summary',
                body: 'valid body',
                contentType: 'guide',
                scenario: 'weekend_trip'
            };
            expect(validateGuide(guide)).toEqual([]);
        });

        it('should return all errors for an empty guide', () => {
            const guide = {
                slug: '',
                title: '',
                summary: '',
                body: '',
                contentType: '',
                scenario: ''
            };
            const errors = validateGuide(guide);
            expect(errors).toContain('slug()');
            expect(errors).toContain('title');
            expect(errors).toContain('summary');
            expect(errors).toContain('body');
            expect(errors).toContain('contentType()');
            expect(errors).toContain('scenario()');
            expect(errors.length).toBe(6);
        });

        it('should catch invalid slug pattern', () => {
            const guide = {
                slug: 'invalid/slug@#$',
                title: 'title',
                summary: 'summary',
                body: 'body',
                contentType: 'guide',
                scenario: 'weekend_trip'
            };
            const errors = validateGuide(guide);
            expect(errors).toContain('slug(invalid/slug@#$)');
        });

        it('should catch invalid contentType and scenario enumerations', () => {
            const guide = {
                slug: 'valid-slug',
                title: 'title',
                summary: 'summary',
                body: 'body',
                contentType: 'invalid_type',
                scenario: 'invalid_scenario'
            };
            const errors = validateGuide(guide);
            expect(errors).toContain('contentType(invalid_type)');
            expect(errors).toContain('scenario(invalid_scenario)');
        });
    });
});
