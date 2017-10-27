micrawler.config(function (env) {
    env.crawlTimeout = 30000; // 30 seconds
    env.requestRetries = 5;
    env.requestTimeout = 10000; // 10 seconds
    env.specLabelPad = 30;
    env.parallelCrawls = 10;

    var tempasBaseUrl = "http://localhost:9000"; //"http://tempas.L3S.de";

    env.specProxyRequest = function(url) {
        return micrawler.request(tempasBaseUrl + "/micrawler/spec/" + url);
    };

    env.crawlQueueRequest = function(spec) {
        var deferred = new $.Deferred();
        if (spec.props && spec.props.type && spec.props.type.value.toLowerCase() === "software") {
            micrawler.request(tempasBaseUrl + "/micrawler/queue", {
                type: "POST",
                data: micrawler.specToStr(spec, true, true),
                contentType: "text/plain"
            }).done(function (success, urlsOrReason) {
                if (success) deferred.resolve(success, urlsOrReason.split("\n"));
                else deferred.resolve(success, urlsOrReason);
            });
        } else {
            var urlSet = {};
            $.each(spec.urls, function (i, item) {
                if (!urlSet[item.url]) urlSet[item.url] = true;
            });
            var queue = Object.keys(urlSet);
            deferred.resolve(true, queue);
        }
        return deferred.promise();
    };

    env.crawlUrl = function(url) {
        return micrawler.loadUrl("http://web.archive.org/save/" + url);
    };

    env.viewUrl = function(url, timestamp) {
        return tempasBaseUrl + "/timeportal/portal/" + timestamp + "/" + url;
    };

    env.analyzers = {
        "software": function(spec) {
            return micrawler.request(tempasBaseUrl + "/micrawler/analyze", {
                type: "POST",
                data: micrawler.specToStr(spec, true, true),
                contentType: "text/plain"
            });
        }
    };

    env.persistenceProviderRequest = function(spec) {
        return micrawler.request(tempasBaseUrl + "/micrawler/permalink", {
            type: "POST",
            data: micrawler.specToStr(spec, true, true),
            contentType: "text/plain"
        });
    };

    env.fetchMetaRequest = function(url, timestamp) {
        var mapMeta = new $.Deferred();
        micrawler.request("http://web.archive.org/cdx/search/cdx?url=" + url + "&sort=closest&closest=" + timestamp).done(function(success, content) {
            if (success) {
                content = content.trim();
                if (content) {
                    var meta = content.split("\n")[0].split(" ");
                    mapMeta.resolve(true, meta);
                } else {
                    mapMeta.resolve(true);
                }
            } else mapMeta.resolve(false);
        });
        return mapMeta.promise();
    };

    env.timestampFromMeta = function(meta) {
        return meta[1];
    }
});