package push

import "testing"

// Spec 2022: the pure prune decision. Dead-subscription reasons prune; reasons
// that mean OUR request was malformed never prune (that would silently
// unsubscribe every healthy device over a server-side bug).
func TestShouldPrune(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   string
		want   bool
	}{
		{"404 always prunes", 404, ``, true},
		{"410 always prunes", 410, `{"reason":"Unregistered"}`, true},
		{"400 dead subscription reasons prune", 400, `{"reason":"BadDeviceToken"}`, true},
		{"400 Unregistered prunes", 400, `{"reason":"Unregistered"}`, true},
		{"403 ExpiredToken prunes", 403, `{"reason":"ExpiredToken"}`, true},
		{"400 DeviceTokenNotForTopic prunes", 400, `{"reason":"DeviceTokenNotForTopic"}`, true},
		{"400 SubscriptionExpired prunes", 400, `{"reason":"SubscriptionExpired"}`, true},
		{"400 our-bug topic reason keeps", 400, `{"reason":"BadWebPushTopic"}`, false},
		{"400 our-bug ttl reason keeps", 400, `{"reason":"BadWebPushTtl"}`, false},
		{"403 our-bug jwt reason keeps", 403, `{"reason":"BadJwtToken"}`, false},
		{"413 payload keeps", 413, `{"reason":"PayloadTooLarge"}`, false},
		{"429 rate limit keeps", 429, ``, false},
		{"400 unknown reason keeps", 400, `{"reason":"SomethingNew"}`, false},
		{"400 empty body keeps", 400, ``, false},
		{"400 non-JSON body keeps", 400, `bad gateway`, false},
		{"success never prunes", 201, ``, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := shouldPrune(c.status, []byte(c.body)); got != c.want {
				t.Fatalf("shouldPrune(%d, %q) = %v, want %v", c.status, c.body, got, c.want)
			}
		})
	}
}
