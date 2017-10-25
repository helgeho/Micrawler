var micrawler = (function() {
	var specUrlSplitRegex = /(.+?)\:[ \t]+(.+)$/;
	var specPropSplitRegex = /([^\=]+)\=(.*)/;
	var loadingTag = "<i class=\"fa fa-spinner fa-spinner fa-pulse\"></i>";
	var loadingText = "loading";
	var cancelBtnSuffixText = "(cancel crawl)";
	var statusColors = ["#2ea442", "#82a42e", "#a48b2e", "#a4492e"];
	var timeoutReason = "timeout";

	var env = {
		crawlTimeout: 30000, // 30 seconds
		requestRetries: 5,
		requestTimeout: 10000, // 10 seconds
		specLabelPad: 30,
		parallelCrawls: 10
	};

	var crawlFrameTimeouts = [];
    var requestCache = {};

	var crawlContext = null;

	var crawlFrameContainerId = "crawl-frame-container";

	var wizardId = "crawl-wizard";
	var $wizard;

	function config(func) {
		func(env);
	}

	function padStr(str, length) {
		while (str.length < length) str += " ";
		return str;
	}

	function showWizard() {
		$wizard.show();
	}

	function wizardHome(cancelCrawl) {
		if (cancelCrawl !== false) stopCrawl();
		$wizard.carousel(0);
		showWizard();
	}
 
	function wizardNext(cancelCrawl) {
		if (cancelCrawl !== false) stopCrawl();
		$wizard.carousel("next");
		showWizard();
	}

	function wizardPrev(cancelCrawl) {
		if (cancelCrawl !== false) stopCrawl();
		$wizard.carousel("prev");
		showWizard();
	}

	function wizardSlideBySelector(selector) {
		var $item = (selector.jquery ? selector : $(selector)).parents("#" + wizardId + " .item");
		return $item.index();
	}

	function wizardGoto(selector, cancelCrawl) {
		if (cancelCrawl !== false) stopCrawl();
		$wizard.carousel(wizardSlideBySelector(selector));
		showWizard();
	}

	function appendDiv($parent, className) {
		return $("<div>").appendTo($parent).addClass(className);
	}

	function popState(location, state) {
		document.location = location;
	}

	function pushState(changeUrl, state) {
		var url = new URI();
		changeUrl(url);
		if (state || url !== document.location.href) {
			window.history.pushState(state || {}, document.title, url);
		}
	}

	function time14(date) {
		date = date || new Date();
		return date.toISOString().replace(/[^\d]/g, "").substr(0, 14);
	}

	function parseTime14(timestamp) {
		var year = timestamp.substring(0, 4) || new Date().getYear();
		var month = timestamp.substring(4, 6) || 6;
		var day = timestamp.substring(6, 8) || 1;
		var hours = timestamp.substring(8, 10) || 0;
		var minutes = timestamp.substring(10, 12) || 0;
		var seconds = timestamp.substring(12, 14) || 0;
		return new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
	}

	function resetCrawlProgress() {
		$("#log-textarea").val("");
		$(".btn-cancel").each(function () {
			var $btn = $(this);
			$btn.text($btn.text() + " " + cancelBtnSuffixText);
		});
		logCrawlProgress(0);
	}

	function logCrawlProgress(progress, message) {
        $progressbar = $("#crawl-progress").find(".progress-bar");
        if (progress !== false) $progressbar.css("width", progress + "%");
        $progressbar.toggleClass("active", !!progress);
        if (message) {
            var $textarea = $("#log-textarea");
            var textarea = $textarea[0];
            var text = $textarea.val();
            var atBottom = textarea.scrollHeight - textarea.scrollTop === textarea.clientHeight;
            $textarea.val(text + (text ? "\n" : "") + progress + "% - " + message);
            if (atBottom) $textarea.scrollTop(textarea.scrollHeight);
        }
	}

	function loadSpec(spec, timestamp) {
		var specStr;
		if (typeof spec === "string") {
			if (/^https?\:\/\/[^ ]+$/.test(spec)) {
				fetchSpec(spec, timestamp);
				return;
			}
			if (!spec.includes(".")) {
				spec = decodeSpec(spec);
				specStr = specToStr(spec, true);
			} else {
				specStr = spec;
				spec = parseSpec(specStr)
			}
		}
		timestamp = timestamp || spec.timestamp;
		if (timestamp) showReport(spec, timestamp);
		else {
			var $specTextarea = $("#spec-textarea");
			$specTextarea.val(specStr);
			wizardGoto($specTextarea);
		}
	}

	function fetchSpec(url, timestamp) {
		$specUrl = $("#spec-url");
		url = url || $specUrl.val();
		$specUrl.val(url);
		env.specProxyRequest(url).done(function(success, content) {
			if (success) {
				loadSpec(content, timestamp);
			} else {
				alert("An error occurred. Is this a valid URL?");
				wizardHome();
			}
		});
	}

	function initContext(spec, timestamp) {
		if (!crawlContext || spec) {
			if (spec === true) spec = null;
			spec = spec || parseSpec();
			timestamp = timestamp || spec.timestamp;
			var specStr = encodeSpec(spec);
			crawlContext = {
				spec: spec,
				specStr: specStr,
				numProcessedUrls: 0,
				processedUrls: {}
			};
			pushState(function (url) {
				url.setQuery("spec", specStr);
			});
		}
		spec = crawlContext.spec;
		if (timestamp) {
			if (timestamp === true) timestamp = spec.timestamp || time14();
			spec.timestamp = timestamp;
			pushState(function (url) {
				url.setQuery("time", timestamp);
			});
		}
	}

	function resetCrawlFrames() {
		$("#" + crawlFrameContainerId).find("iframe").remove();
		$.each(crawlFrameTimeouts, function (i, timeout) {
		    clearTimeout(timeout);
        });
	}

	function startCrawl() {
		stopCrawl();
		resetCrawlProgress();
		initContext();
		var spec = crawlContext.spec;
		env.crawlQueueRequest(spec).done(function (success, queueOrReason) {
		    if (success) {
                initContext(spec, time14());
                crawlContext.crawling = true;
		        var queue = queueOrReason;
                crawlContext.numUrls = queue.length;
                crawlContext.queue = queue;
                var slots = env.parallelCrawls;
                while (crawlContext.queue.length > 0 && slots-- > 0) {
                    crawlUrl(crawlContext.queue.pop());
                }
                monitorCrawl();
                wizardGoto($progressbar, false);
            } else {
		        alert("Fetching crawl queue failed: " + queueOrReason)
            }
        });
	}

	function stopCrawl() {
		if (crawlContext) crawlContext.crawling = false;
		logCrawlProgress(false);
		var suffixRe = new RegExp(" +" + cancelBtnSuffixText.replace(/[\(\)]/g, "\\$&") + "$");
		$(".btn-cancel").each(function () {
			var $btn = $(this);
			$btn.text($btn.text().replace(suffixRe, ""));
		});
		resetCrawlFrames();
	}

	function dateToStr(date) {
		if (typeof date === "string") date = parseTime14(date);
		return date.toISOString().substr(0, 19).replace("T", " ") + " UTC";
	}

	function setStatusIndicator($status, url, referenceTimestamp, success, meta) {
		var text;
		var color;
		var hover;
		var viewUrl;
		if (success) {
			if (meta) {
				hover = meta.join(" ");
				var timestamp = env.timestampFromMeta(meta);
				if (timestamp) {
					var referenceTime = parseTime14(referenceTimestamp);
					var time = parseTime14(timestamp);
					var distance = Math.abs(referenceTime - time);
					text = dateToStr(time);
					if (distance < 60 * 60 * 1000) { // one hour
						color = statusColors[0];
					} else if (distance < 24 * 60 * 60 * 1000) { // 24 hours
						color = statusColors[1];
					} else {
						color = statusColors[2];
					}
					viewUrl = env.viewUrl(url, timestamp);
				}
			} else {
				text = "N/A";
				color = statusColors[statusColors.length - 1];
			}
		} else {
			text = "failed";
			color = statusColors[statusColors.length - 1];
		}
		$status.attr("title", hover || text);
		$status.text(text);
		$status.css("color", color);
		if (viewUrl) {
			var $link = $status.parents("a");
			$link.attr("href", viewUrl);
			$link.css("cursor", "pointer");
		}
	}

	function showSpec(spec, timestamp) {
		var $specTextarea = $("#spec-textarea");
		spec = spec || (crawlContext && crawlContext.spec);
		if (spec) {
			spec.timestamp = timestamp || spec.timestamp;
			$specTextarea.val(specToStr(spec, true, true));
		}
		wizardGoto($specTextarea);
	}

    function request(url, settings, retry, deferred) {
    	var cache = !settings || !settings.type || settings.type.toLowerCase() === "get";
    	var promise = requestCache[url];
        if (!promise || retry) {
            deferred = deferred || new $.Deferred();
            promise = deferred.promise();
            if (cache) requestCache[url] = promise;
	    	retry = retry || 0;
			function fail() {
	            if (retry < env.requestRetries) request(url, settings, retry + 1, deferred);
	            else deferred.resolve(false, timeoutReason);
			}
			var requestTimeout = setTimeout(fail, env.requestTimeout);
	    	$.ajax($.extend({
	    		type: "GET",
	    		url: url
	    	}, settings)).done(function(content) {
                clearTimeout(requestTimeout);
				deferred.resolve(true, content);
			}).fail(function() {
                clearTimeout(requestTimeout);
				fail();
			});
        }
        return promise;
    }

	function fetchMeta(spec, timestamp) {
		initContext(spec, timestamp || true);
		spec = crawlContext.spec;
		var pending = spec.urls.length;
		$.each(spec.urls, function (i, item) {
            env.fetchMetaRequest(item.url, timestamp).done(function (success, meta) {
				item.meta = meta;
				if (--pending === 0) {
					spec.includesMeta = true;
					onMetaFetched(spec);
				}
			});
		});
	}

	function onMetaFetched(spec) {
		if (crawlContext.requestMeta) setCiteTabs(spec);
		if (spec.props && spec.props.type && spec.props.type.value.toLowerCase() in env.analyzers) {
			var analyzer = env.analyzers[spec.props.type.value];
			analyzer(spec).done(function(success, result) {
				var $analysisPanel = $("#report-analysis-result");
				var $analysisStatus = $("#report-analysis-result-status");
				if (success && result.metadata) {
					$analysisStatus.empty();
					$table = $analysisPanel.children("table");
					var $tbody = $table.children("tbody");
					$tbody.empty();
					$.each(result.metadata, function (key, value) {
						$tbody.append("<tr><td>" + key + "</td><td>" + value + "</td></tr>");
					});
					$table.show();
				} else {
					$analysisStatus.text("fetching analysis results failed");
				}
			});
		}
	}

	function generateBibtex(type, spec, permalink) {
		var indent = "    ";
		var str = "@" + type + "{";
		if (spec.props.title) str += spec.props.title.value.replace(/\W+/, "-").replace(" +", "_");
		else str += "unnamed";
		str += ",\n";
		if (spec.props.title) str += indent + "title = {{" + spec.props.title.value + "}},\n";
		if (spec.props.type) str += indent + "type = {" + spec.props.type.value + "},\n";
		if (type === "online") {
			str += indent + "url = {" + permalink + "},\n"
			str += indent + "urldate = {" + parseTime14(spec.timestamp).toISOString() + "},\n";
			str += indent + "note = {Archived using Micrawler}\n";
		} else {
			str += indent + "howpublished = {\\url{" + permalink + "}},\n"
			str += indent + "note = {Archived using Micrawler: " + parseTime14(spec.timestamp).toISOString() + "}\n";
		}
		str += "}";
		return str;
	}

	function showCiteTabs(spec) {
		spec = spec || crawlContext.spec;
		setCiteTabs(spec);
		$("#cite-modal").modal("show");
	}

	function setCiteTabs(spec) {
		$("#cite-modal").find("textarea").val(loadingText);
		if (spec.includesMeta) {
			function set(permalinkStr, bibtexStr, biblatexStr) {
				$("#cite-tab-permalink").val(permalinkStr);
				$("#cite-tab-bibtex").val(bibtexStr || permalinkStr);
				$("#cite-tab-biblatex").val(biblatexStr || permalinkStr);
			}
			if (spec.permalink) {
				set(spec.permalink, generateBibtex("misc", spec, spec.permalink), generateBibtex("online", spec, spec.permalink));
			} else {
				env.persistenceProviderRequest(spec).done(function(success, permalink) {
					if (success) {
						spec.permalink = permalink;
			            set(permalink, generateBibtex("misc", spec, permalink), generateBibtex("online", spec, permalink));
					} else {
						set("error");
					}
				});
			}
		} else {
			crawlContext.requestMeta = true;
		}
	}

	function showReport(spec, timestamp) {
		fetchMeta(spec, timestamp);
		spec = crawlContext.spec;
		$("#report-time").text(dateToStr(spec.timestamp));
		var $analysisPanel = $("#report-analysis-result");
		$analysisPanel.hide();
		$analysisPanel.children("table").hide();
		var $analysisStatus = $("#report-analysis-result-status");
		$analysisStatus.empty();
		$head = $("#report-head");
		$head.hide();
		$title = $("#report-title");
		$title.hide();
		$type = $("#report-type");
		$type.hide();
		if (spec.props) {
			var title = spec.props.title;
			if (title) {
				$title.text(title.value);
				$title.show();
				$head.show();
			}
			var type = spec.props.type;
			if (type) {
				$type.text("(" + type.value + ")");
				$type.show();
				$head.show();
				if (type.value.toLowerCase() in env.analyzers) {
					$analysisStatus.html(loadingTag);
					$analysisPanel.show();
				}
			}
		}
		var $container = $("#report-container");
		$container.empty();
		$.each(spec.urls, function (i, item) {
			var $item = $("<a target=\"_blank\">").appendTo($container).addClass("report-item");
			var $label = appendDiv($item, "report-label");
			var $status = appendDiv($item, "report-status");
			var $url = appendDiv($item, "report-url");

			$label.text(item.label || item.url);
			$label.attr("title", item.label || item.url);
			$status.html(loadingTag);
			$url.text(item.url);
			$url.attr("title", item.url);

            env.fetchMetaRequest(item.url, timestamp).done(function (success, meta) {
				setStatusIndicator($status, item.url, spec.timestamp, success, meta);
			});
		});
		wizardGoto($container);
	}

	function specToStr(spec, pretty, includeMeta) {
		var specStr = "";
		if (includeMeta && spec.timestamp) specStr += "@" + spec.timestamp;
		if (spec.comment) {
			if (specStr) specStr += "\n";
			specStr += spec.comment;
		}
		$.each(Object.keys(spec.props), function (i, propKey) {
			if (specStr) specStr += "\n";
			var prop = spec.props[propKey];
			specStr += padStr(propKey + "= ", pretty ? env.specLabelPad : 0) + prop.value;
			if (prop.comment) specStr += "\n" + prop.comment;
		});
		$.each(spec.urls, function (i, item) {
			if (specStr) specStr += "\n";
			if (item.label) specStr += padStr(item.label + ": ", pretty ? env.specLabelPad : 0);
			specStr += item.url;
			if (includeMeta && item.meta) specStr += " " + item.meta.join(" ");
            if (item.comment) specStr += "\n" + item.comment;
			if (item.props) $.each(Object.keys(item.props), function (i, propKey) {
				var prop = item.props[propKey];
				specStr += "\n" + padStr(propKey + "= ", pretty ? env.specLabelPad : 0) + prop.value;
				if (prop.comment) specStr += "\n" + prop.comment;
			});
		});
		return specStr;
	}

	function encodeSpec(spec, includeMeta) {
		var specStr = specToStr(spec, false, includeMeta);
		return LZString.compressToEncodedURIComponent(specStr);
	}

	function decodeSpec(spec) {
		var specStr = LZString.decompressFromEncodedURIComponent(spec);
		return parseSpec(specStr);
	}

	function parseSpec(str) {
		str = str || $("#spec-textarea").val();
		var urls = [];
		var props = {};
		var spec = {
			"urls": urls,
			"props": props
		};
		var lines = str.split("\n");
		if (lines[0].startsWith("@")) spec.timestamp = lines.shift().substr(1).trim();
		var commentItem = spec, comment = "";
		$.each(lines, function (i, line) {
			var trim = line.trim();
			if (trim.length > 0 && !trim.startsWith("#")) {
				var match = specUrlSplitRegex.exec(trim);
				var label;
				var url;
				if (match !== null) {
					label = match[1].trim();
					url = match[2];
				} else {
					match = specPropSplitRegex.exec(trim);
					if (match !== null) {
						var prop = {"value": match[2].trim()};
						props[match[1].trim()] = prop;
						if (comment) commentItem.comment = comment;
						commentItem = prop;
						comment = "";
					} else {
						url = trim;
					}
				}
				if (url) {
					var item = {};
					if (label) item.label = label;
					var urlSplit = url.split(/[ \t]+/);
					item.url = urlSplit.shift().split("#")[0].trim();
					if (urlSplit.length > 0) item.meta = urlSplit;
					props = {};
					item.props = props;
					urls.push(item);
					if (comment) commentItem.comment = comment;
					commentItem = item;
					comment = "";
				}
			} else {
				if (comment) comment += "\n";
				comment += trim;
			}
		});
		if (comment) commentItem.comment = comment;
		return spec;
	}

	function createCrawlFrame(url) {
		var $frame = $("<iframe>").addClass("crawl-frame").attr("src", url).attr("sandbox", "allow-scripts");
		$("#" + crawlFrameContainerId).append($frame);
		return $frame;
	}

	function loadUrl(url) {
		var $frame = createCrawlFrame(url);
        var deferred = new $.Deferred();
        var crawlTimeout = setTimeout(function() {
            $frame.off("load.micrawler");
            crawlFrameTimeouts.splice(crawlFrameTimeouts.indexOf(crawlTimeout), 1);
            $frame.remove();
            deferred.resolve(false, timeoutReason);
        }, env.crawlTimeout);
        crawlFrameTimeouts.push(crawlTimeout);
        $frame.one("load.micrawler", function() {
            clearTimeout(crawlTimeout);
            crawlFrameTimeouts.splice(crawlFrameTimeouts.indexOf(crawlTimeout), 1);
            $frame.remove();
        	deferred.resolve(true);
        });
		return deferred.promise();
	}

	function monitorCrawl(url, success, failReason) {
		if (crawlContext && crawlContext.crawling) {
		    var proceedCrawl = false;
			if (url && !crawlContext.processedUrls[url]) {
				crawlContext.processedUrls[url] = true;
				crawlContext.numProcessedUrls += 1;
                proceedCrawl = true;
			}
			var progress = Math.floor((crawlContext.numProcessedUrls + 1) / (crawlContext.numUrls + 1) * 100);
			if (proceedCrawl) {
                logCrawlProgress(progress, url + " : " + (success ? "done" : failReason) + ".");
                if (crawlContext.queue.length > 0) {
                    crawlUrl(crawlContext.queue.pop());
                } else if (progress === 100) {
                    logCrawlProgress(progress, "crawl finished.");
                    stopCrawl();
                }
            } else {
			    logCrawlProgress(progress);
            }
		}
	}

	function crawlUrl(url) {
	    env.crawlUrl(url).done(function (success, failReason) {
            monitorCrawl(url, success, failReason);
        });
    }

	$(function() {
		$wizard = $("#" + wizardId);

		window.addEventListener('popstate', function (event) {
			popState(document.location, event.state);
		});
	});

	return {
		specToStr: specToStr,
        loadUrl: loadUrl,
		request: request,
		loadSpec: loadSpec,
		wizardNext: wizardNext,
		wizardPrev: wizardPrev,
		showSpec: showSpec,
		showReport: showReport,
		startCrawl: startCrawl,
		stopCrawl: stopCrawl,
		fetchSpec: fetchSpec,
		showWizard: showWizard,
		wizardHome: wizardHome,
		showCiteTabs: showCiteTabs,
        config: config
	};
})();