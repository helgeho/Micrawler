$(function() {
	var query = new URI().query(true);
	if (query.spec) {
		micrawler.loadSpec(query.spec, query.time);
	} else {
		micrawler.showWizard();
	}
});